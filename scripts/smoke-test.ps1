param(
  [string]$BaseUrl = 'http://localhost:4000',
  [ValidateSet('full', 'degraded')]
  [string]$Mode = 'full',
  [string]$EnvFile = '.env',
  [string]$AdminEmail,
  [string]$AdminPassword,
  [string]$AdminMfaTotpCode,
  [string]$AdminMfaRecoveryCode
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot

function Resolve-ConfigValue {
  param(
    [string]$ExplicitValue,
    [string]$EnvironmentVariableName,
    [hashtable]$EnvValues
  )

  if (-not [string]::IsNullOrWhiteSpace($ExplicitValue)) {
    return $ExplicitValue
  }

  $environmentValue = [System.Environment]::GetEnvironmentVariable($EnvironmentVariableName)
  if (-not [string]::IsNullOrWhiteSpace($environmentValue)) {
    return $environmentValue
  }

  return $EnvValues[$EnvironmentVariableName]
}

function Read-EnvValues {
  param([string]$Path)

  $values = @{}
  if (-not (Test-Path $Path)) {
    return $values
  }

  foreach ($line in Get-Content -Path $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) {
      continue
    }

    $parts = $trimmed -split '=', 2
    $values[$parts[0]] = $parts[1]
  }

  return $values
}

function Read-ResponseBody {
  param([object]$Response)

  if ($null -eq $Response) {
    return $null
  }

  if ($Response.PSObject.Methods.Name -contains 'GetResponseStream') {
    $stream = $Response.GetResponseStream()
    if ($null -eq $stream) {
      return $null
    }

    $reader = New-Object System.IO.StreamReader($stream)
    return $reader.ReadToEnd()
  }

  if ($Response.PSObject.Properties.Name -contains 'Content') {
    $content = $Response.Content

    if ($content -is [string]) {
      return $content
    }

    if ($null -ne $content -and $content.PSObject.Methods.Name -contains 'ReadAsStringAsync') {
      return $content.ReadAsStringAsync().GetAwaiter().GetResult()
    }
  }

  return $null
}

function Convert-ResponseBody {
  param([string]$BodyText)

  if ([string]::IsNullOrWhiteSpace($BodyText)) {
    return $null
  }

  try {
    return $BodyText | ConvertFrom-Json
  } catch {
    return $BodyText
  }
}

function Invoke-Api {
  param(
    [string]$Method,
    [string]$Url,
    [object]$Body,
    [object]$Session,
    [string]$SessionVariable,
    [int[]]$ExpectedStatusCodes = @(200)
  )

  $headers = @{
    Accept = 'application/json'
  }

  $invokeParams = @{
    Method = $Method
    Uri = $Url
    Headers = $headers
  }

  $invokeWebRequestCommand = Get-Command Invoke-WebRequest
  if ($invokeWebRequestCommand.Parameters.ContainsKey('UseBasicParsing')) {
    $invokeParams['UseBasicParsing'] = $true
  }

  if ($null -ne $Session) {
    $invokeParams['WebSession'] = $Session
  }

  if (-not [string]::IsNullOrWhiteSpace($SessionVariable)) {
    $invokeParams['SessionVariable'] = $SessionVariable
  }

  if ($null -ne $Body) {
    $invokeParams['ContentType'] = 'application/json'
    $invokeParams['Body'] = ($Body | ConvertTo-Json -Depth 8)
  }

  try {
    $response = Invoke-WebRequest @invokeParams
    if ([string]::IsNullOrWhiteSpace($response.Content)) {
      return $null
    }

    return $response.Content | ConvertFrom-Json
  } catch {
    $response = $_.Exception.Response
    if ($null -ne $response) {
      $statusCode = [int]$response.StatusCode
      $normalizedExpectedStatusCodes = @($ExpectedStatusCodes | ForEach-Object { [int]$_ })
      $bodyText = Read-ResponseBody -Response $response
      $parsedBody = Convert-ResponseBody -BodyText $bodyText

      if ($normalizedExpectedStatusCodes -contains $statusCode) {
        if ($null -ne $parsedBody) {
          return $parsedBody
        }

        return [pscustomobject]@{
          statusCode = $statusCode
        }
      }

      if ([string]::IsNullOrWhiteSpace($bodyText)) {
        throw "Request $Method $Url failed with status $statusCode."
      }

      throw "Request $Method $Url failed with status $statusCode. Body: $bodyText"
    }

    throw
  }
}

function Assert-HasValue {
  param(
    [object]$Value,
    [string]$Message
  )

  if ($null -eq $Value -or ($Value -is [string] -and [string]::IsNullOrWhiteSpace($Value))) {
    throw $Message
  }
}

$envValues = Read-EnvValues -Path (Join-Path $repoRoot $EnvFile)

$AdminEmail = Resolve-ConfigValue -ExplicitValue $AdminEmail -EnvironmentVariableName 'ADMIN_EMAIL' -EnvValues $envValues
$AdminPassword = Resolve-ConfigValue -ExplicitValue $AdminPassword -EnvironmentVariableName 'ADMIN_PASSWORD' -EnvValues $envValues
$AdminMfaTotpCode = Resolve-ConfigValue -ExplicitValue $AdminMfaTotpCode -EnvironmentVariableName 'ADMIN_MFA_TOTP_CODE' -EnvValues $envValues
$AdminMfaRecoveryCode = Resolve-ConfigValue -ExplicitValue $AdminMfaRecoveryCode -EnvironmentVariableName 'ADMIN_MFA_RECOVERY_CODE' -EnvValues $envValues

$live = Invoke-Api -Method 'GET' -Url "$BaseUrl/api/health/live" -Body $null -Session $null
Assert-HasValue -Value $live.status -Message 'El endpoint /api/health/live no devolvio estado.'
Write-Host "live: $($live.status)"

if ($Mode -eq 'degraded') {
  $ready = Invoke-Api -Method 'GET' -Url "$BaseUrl/api/health/ready" -Body $null -Session $null -ExpectedStatusCodes @(200, 503)
  if ($null -ne $ready -and $ready.PSObject.Properties.Name -contains 'statusCode') {
    Write-Host "ready: $($ready.statusCode)"
  } elseif ($null -ne $ready -and $ready.PSObject.Properties.Name -contains 'status') {
    Write-Host "ready: $($ready.status)"
  } else {
    Write-Host 'ready: degraded'
  }
  Write-Host 'Smoke test degradado completado.'
  return
}

Assert-HasValue -Value $AdminEmail -Message 'ADMIN_EMAIL no esta configurado.'
Assert-HasValue -Value $AdminPassword -Message 'ADMIN_PASSWORD no esta configurado.'

$ready = Invoke-Api -Method 'GET' -Url "$BaseUrl/api/health/ready" -Body $null -Session $null
Assert-HasValue -Value $ready.status -Message 'El endpoint /api/health/ready no devolvio estado ready.'
Write-Host "ready: $($ready.status)"

$webSession = $null

$login = Invoke-Api -Method 'POST' -Url "$BaseUrl/api/auth/login" -Body @{
  email = $AdminEmail
  password = $AdminPassword
} -SessionVariable 'script:webSession'
Write-Host "login: mfaRequired=$($login.mfaRequired)"

if ($login.mfaRequired) {
  $mfaMethod = $null
  $mfaCode = $null

  if (-not [string]::IsNullOrWhiteSpace($AdminMfaTotpCode)) {
    $mfaMethod = 'totp'
    $mfaCode = $AdminMfaTotpCode
  } elseif (-not [string]::IsNullOrWhiteSpace($AdminMfaRecoveryCode)) {
    $mfaMethod = 'recovery_code'
    $mfaCode = $AdminMfaRecoveryCode
  } else {
    throw 'El login requiere MFA. Define ADMIN_MFA_TOTP_CODE o ADMIN_MFA_RECOVERY_CODE para ejecutar smoke:test con un usuario que tenga MFA habilitado.'
  }

  $mfaResult = Invoke-Api -Method 'POST' -Url "$BaseUrl/api/auth/mfa/verify" -Body @{
    code = $mfaCode
    method = $mfaMethod
  } -Session $webSession
  Write-Host "mfa: method=$mfaMethod remainingRecoveryCodes=$($mfaResult.remainingRecoveryCodes)"
}

$me = Invoke-Api -Method 'GET' -Url "$BaseUrl/api/auth/me" -Body $null -Session $webSession
Write-Host "me: user=$($me.user.email)"

$sessions = Invoke-Api -Method 'GET' -Url "$BaseUrl/api/sessions" -Body $null -Session $webSession
Write-Host "sessions: count=$($sessions.items.Count)"

$customer = Invoke-Api -Method 'POST' -Url "$BaseUrl/api/customers" -Body @{
  name = 'Acme Smoke SA'
  taxId = 'XAXX010101000'
  email = 'facturacion-smoke@example.com'
  phone = '5550001111'
} -Session $webSession
Assert-HasValue -Value $customer.customer.id -Message 'No se pudo crear el customer en smoke test.'
Write-Host "customer:create id=$($customer.customer.id) status=$($customer.customer.status)"

$customerList = Invoke-Api -Method 'GET' -Url "$BaseUrl/api/customers" -Body $null -Session $webSession
Write-Host "customer:list count=$($customerList.items.Count) source=$($customerList.source)"

$customerListCached = Invoke-Api -Method 'GET' -Url "$BaseUrl/api/customers" -Body $null -Session $webSession
Write-Host "customer:list:cached count=$($customerListCached.items.Count) source=$($customerListCached.source)"

$customerRead = Invoke-Api -Method 'GET' -Url "$BaseUrl/api/customers/$($customer.customer.id)" -Body $null -Session $webSession
Write-Host "customer:get id=$($customerRead.customer.id) source=$($customerRead.source)"

$customerReadCached = Invoke-Api -Method 'GET' -Url "$BaseUrl/api/customers/$($customer.customer.id)" -Body $null -Session $webSession
Write-Host "customer:get:cached id=$($customerReadCached.customer.id) source=$($customerReadCached.source)"

$customerUpdate = Invoke-Api -Method 'PATCH' -Url "$BaseUrl/api/customers/$($customer.customer.id)" -Body @{
  phone = '5550002222'
  status = 'INACTIVE'
} -Session $webSession
Write-Host "customer:update id=$($customerUpdate.customer.id) status=$($customerUpdate.customer.status)"

$payment = Invoke-Api -Method 'POST' -Url "$BaseUrl/api/payments" -Body @{
  amount = 125.50
  currency = 'MXN'
  bankAccountRef = 'acct_smoke_001'
  externalReference = 'smoke-payment-001'
  concept = 'Smoke test payment'
} -Session $webSession
Assert-HasValue -Value $payment.payment.id -Message 'No se pudo crear el pago en smoke test.'
Write-Host "payment: id=$($payment.payment.id) status=$($payment.payment.status)"

$payments = Invoke-Api -Method 'GET' -Url "$BaseUrl/api/payments" -Body $null -Session $webSession
Write-Host "payments: count=$($payments.items.Count)"

$invoice = Invoke-Api -Method 'POST' -Url "$BaseUrl/api/invoices" -Body @{
  customerTaxId = $customer.customer.taxId
  currency = 'MXN'
  subtotal = 100
  total = 116
  paymentId = $payment.payment.id
} -Session $webSession
Assert-HasValue -Value $invoice.invoice.id -Message 'No se pudo crear la factura en smoke test.'
Write-Host "invoice: id=$($invoice.invoice.id) status=$($invoice.invoice.status)"

$invoiceList = Invoke-Api -Method 'GET' -Url "$BaseUrl/api/invoices" -Body $null -Session $webSession
Write-Host "invoices: count=$($invoiceList.items.Count)"

$stamped = Invoke-Api -Method 'POST' -Url "$BaseUrl/api/invoices/stamp" -Body @{
  invoiceId = $invoice.invoice.id
} -Session $webSession
Write-Host "stamp: status=$($stamped.invoice.status) pacReference=$($stamped.invoice.pacReference)"

$cancelled = Invoke-Api -Method 'POST' -Url "$BaseUrl/api/invoices/cancel" -Body @{
  invoiceId = $invoice.invoice.id
  reason = 'Smoke test cleanup'
} -Session $webSession
Write-Host "cancel: status=$($cancelled.invoice.status) cancellationRef=$($cancelled.invoice.cancellationRef)"

$customerDelete = Invoke-Api -Method 'DELETE' -Url "$BaseUrl/api/customers/$($customer.customer.id)" -Body $null -Session $webSession
Write-Host "customer:delete message=$($customerDelete.message)"

[void](Invoke-Api -Method 'POST' -Url "$BaseUrl/api/auth/logout" -Body @{} -Session $webSession)
Write-Host 'logout: ok'
Write-Host 'Smoke test completo finalizado correctamente.'
