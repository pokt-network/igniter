import type { Config } from 'jest';

const config: Config = {
    rootDir: '.',
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.test.ts'],
    moduleNameMapper: {
        '^@tx-verify/(.*)$': '<rootDir>/src/$1',
    },
    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                tsconfig: '<rootDir>/tsconfig.json',
                diagnostics: false,
            },
        ],
    },
};

export default config;
