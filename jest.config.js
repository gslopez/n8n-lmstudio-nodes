/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testPathIgnorePatterns: ['/dist/', '/node_modules/', '\\.integration\\.test\\.ts$'],
    moduleNameMapper: {
        '^nodes/(.*)$': '<rootDir>/nodes/$1',
        '^credentials/(.*)$': '<rootDir>/credentials/$1',
    },
};
