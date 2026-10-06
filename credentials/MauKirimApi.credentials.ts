import {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class MauKirimApi implements ICredentialType {
	name = 'mauKirimApi';

	displayName = 'MauKirim API';

	// n8n requires a themed icon on every credential, resolved relative to this file.
	icon = { light: 'file:maukirim.svg', dark: 'file:maukirim-dark.svg' } as const;

	documentationUrl = 'https://maukirim.com';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'API key of your MauKirim account, starting with mk_live_',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://app.maukirim.com/api/v1',
			required: true,
			description: 'Base URL of the MauKirim API. Change it only to target another deployment.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// GET /account accepts any valid key, including notification-only and OTP-only keys.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/account',
			method: 'GET',
		},
	};
}
