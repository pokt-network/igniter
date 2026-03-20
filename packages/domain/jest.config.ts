import type { Config } from 'jest';

const config: Config = {
    rootDir: '.',
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.test.ts'],
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '^@igniter/domain/(.*)$': '<rootDir>/src/$1',
        '^@igniter/pocket/proto/(.*)$': '<rootDir>/../pocket/src/proto/generated/$1',
        '^@igniter/pocket/(.*)$': '<rootDir>/../pocket/src/$1',
        '^@igniter/pocket$': '<rootDir>/../pocket/src/index.ts',
        '^@igniter/db/(.*)$': '<rootDir>/../db/src/$1',
        '^@igniter/logger$': '<rootDir>/../logger/src/index.ts',
        '^@pocket/(.*)$': '<rootDir>/../pocket/src/$1',
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
