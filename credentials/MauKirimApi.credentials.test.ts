import { INodeProperties } from 'n8n-workflow';

import { MauKirimApi } from './MauKirimApi.credentials';

const credential = new MauKirimApi();

function property(name: string): INodeProperties {
	const found = credential.properties.find((candidate) => candidate.name === name);
	if (found === undefined) throw new Error(`No credential property named ${name}`);
	return found;
}

describe('MauKirimApi credential', () => {
	it('is named mauKirimApi', () => {
		expect(credential.name).toBe('mauKirimApi');
		expect(credential.displayName).toBe('MauKirim API');
	});

	it('sends the API key as a Bearer Authorization header', () => {
		expect(credential.authenticate).toEqual({
			type: 'generic',
			properties: {
				headers: {
					Authorization: '=Bearer {{$credentials.apiKey}}',
				},
			},
		});
	});

	it('takes the API key as a hidden password field', () => {
		expect(property('apiKey').type).toBe('string');
		expect(property('apiKey').required).toBe(true);
		expect(property('apiKey').typeOptions).toEqual({ password: true });
	});

	it('defaults the base URL to the production API', () => {
		expect(property('baseUrl').default).toBe('https://app.maukirim.com/api/v1');
	});

	it('declares light and dark icon variants, as n8n requires of a credential', () => {
		expect(credential.icon).toEqual({
			light: 'file:maukirim.svg',
			dark: 'file:maukirim-dark.svg',
		});
	});

	it('tests the credential with a read request against the configured base URL', () => {
		expect(credential.test).toEqual({
			request: {
				baseURL: '={{$credentials.baseUrl}}',
				url: '/devices',
				method: 'GET',
			},
		});
	});
});
