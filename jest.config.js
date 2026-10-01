/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>/credentials', '<rootDir>/nodes'],
	testMatch: ['**/*.test.ts'],
	clearMocks: true,
	transform: {
		'^.+\\.ts$': ['ts-jest', { tsconfig: { noUnusedLocals: false, noUnusedParameters: false } }],
	},
};
