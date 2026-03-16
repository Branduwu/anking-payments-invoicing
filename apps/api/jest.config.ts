import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  testEnvironment: 'node',
  clearMocks: true,
};

export default config;
