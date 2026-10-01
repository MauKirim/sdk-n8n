import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class MauKirimApi implements ICredentialType {
	name = 'mauKirimApi';

	displayName = 'MauKirim API';

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

	authenticate = {
		type: 'generic' as const,
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/devices',
			method: 'GET' as const,
		},
	};
}
