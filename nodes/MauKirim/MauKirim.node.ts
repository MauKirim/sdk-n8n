import {
	IDataObject,
	IExecuteFunctions,
	INode,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';

import { HttpMethod, HttpRequestFn, MauKirimApiError, request } from './transport';

const DEFAULT_BASE_URL = 'https://app.maukirim.com/api/v1';

/** Documented webhook events of `POST /devices/{id}/webhook`. */
const WEBHOOK_EVENTS = [
	'message',
	'message.reaction',
	'message.revoked',
	'message.edited',
	'message.ack',
	'message.deleted',
	'chat_presence',
	'group.participants',
	'group.joined',
	'label.edit',
	'label.association',
	'newsletter.joined',
	'newsletter.left',
	'newsletter.message',
	'newsletter.mute',
	'call.offer',
];

/** Short explanations for the documented API error codes. */
const ERROR_HINTS: Record<string, string> = {
	api_key_invalid: 'The API key is missing, malformed, or does not match any key.',
	api_key_revoked: 'The API key has been revoked.',
	api_key_expired: 'The API key is past its expiry date.',
	api_key_scope_denied: 'The API key lacks the scope this operation requires.',
	forbidden: 'The account is missing or not active.',
	rental_not_found: 'This account does not rent that number, or the device does not exist.',
	invalid_input: 'A field is missing or malformed. JSON routes also require a JSON content type.',
	batch_idempotency_conflict: 'The Idempotency-Key was already used with a different request.',
	batch_too_large: 'The message, caption, or idempotency key is too long.',
	rate_limited: 'Too many OTP codes were requested for this number. Try again later.',
	insufficient_credits: 'The account balance is below the cost of this message. Top up, then retry.',
	device_not_connected: 'No sending number is ready. Check the connection of the rented number.',
	worker_offline: 'The dispatch worker has no fresh heartbeat. Retry with the same Idempotency-Key.',
	gateway_not_found: 'The gateway of this device no longer exists.',
	gateway_disabled: 'The gateway was switched off by the operator.',
	media_unavailable: 'The media id is unknown, expired after 7 days, or belongs to another account.',
	device_not_found: 'The device id is unknown to this deployment.',
	rental_device_not_ready: 'The device is reachable but too stale to send from.',
	webhook_not_configured: 'This device has no webhook destination configured.',
	not_found: 'The referenced record does not exist for this account.',
	server_error: 'The API hit an unexpected error.',
};

/**
 * n8n requires every failure a node raises to be a `NodeOperationError` or a `NodeApiError`.
 * An error this node already classified keeps its own type and message; a MauKirim envelope becomes
 * an operation error described by its code; anything else is wrapped as an API error.
 */
function classifyFailure(error: unknown, node: INode, itemIndex: number): Error {
	if (error instanceof NodeOperationError || error instanceof NodeApiError) {
		return error;
	}

	if (error instanceof MauKirimApiError) {
		return new NodeOperationError(node, error.message, {
			itemIndex,
			description:
				ERROR_HINTS[error.code] ?? `MauKirim API responded with the code "${error.code}".`,
		});
	}

	return new NodeApiError(node, error as JsonObject, { itemIndex });
}

interface MauKirimCredentials {
	apiKey: string;
	baseUrl?: string;
}

interface OperationCall {
	method: HttpMethod;
	path: string;
	body?: IDataObject;
	idempotencyKey?: string;
	qs?: Record<string, string | number>;
}

function parseVariables(
	context: IExecuteFunctions,
	itemIndex: number,
	raw: unknown,
): IDataObject {
	if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
		return raw as IDataObject;
	}

	if (typeof raw !== 'string') {
		throw new NodeOperationError(context.getNode(), 'Variables must be a JSON object', {
			itemIndex,
		});
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new NodeOperationError(context.getNode(), 'Variables must be valid JSON', {
			itemIndex,
		});
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new NodeOperationError(context.getNode(), 'Variables must be a JSON object', {
			itemIndex,
		});
	}

	return parsed as IDataObject;
}

/**
 * Maps the selected resource and operation to the endpoint it calls. The
 * returned call is exactly what the API documents for that operation.
 */
function buildOperation(context: IExecuteFunctions, itemIndex: number): OperationCall {
	const resource = context.getNodeParameter('resource', itemIndex) as string;
	const operation = context.getNodeParameter('operation', itemIndex) as string;
	const required = (name: string): string => context.getNodeParameter(name, itemIndex) as string;

	switch (resource) {
		case 'otp':
			if (operation === 'send') {
				return {
					method: 'POST',
					path: '/otp/send',
					body: { phone: required('phone'), purpose: required('purpose') },
					idempotencyKey: required('idempotencyKey'),
				};
			}
			if (operation === 'verify') {
				return {
					method: 'POST',
					path: '/otp/verify',
					body: { challengeId: required('challengeId'), code: required('code') },
				};
			}
			break;

		case 'notification':
			if (operation === 'send') {
				const body: IDataObject = {
					phone: required('phone'),
					templateId: required('templateId'),
					variables: parseVariables(context, itemIndex, context.getNodeParameter('variables', itemIndex, '{}')),
				};

				const attachmentUploadId = context.getNodeParameter(
					'attachmentUploadId',
					itemIndex,
					'',
				) as string;
				if (attachmentUploadId !== '') {
					body.attachmentUploadId = attachmentUploadId;
				}

				return {
					method: 'POST',
					path: '/messages/send',
					body,
					idempotencyKey: required('idempotencyKey'),
				};
			}
			if (operation === 'getReceiptWebhook') {
				return { method: 'GET', path: '/notifications/webhook' };
			}
			if (operation === 'setReceiptWebhook') {
				return {
					method: 'POST',
					path: '/notifications/webhook',
					body: {
						url: required('url'),
						active: context.getNodeParameter('active', itemIndex, true) as boolean,
					},
				};
			}
			if (operation === 'rotateReceiptWebhook') {
				return { method: 'PUT', path: '/notifications/webhook' };
			}
			if (operation === 'removeReceiptWebhook') {
				return { method: 'DELETE', path: '/notifications/webhook' };
			}
			break;

		case 'template': {
			if (operation === 'list') {
				return { method: 'GET', path: '/templates' };
			}

			const path = (): string => `/templates/${encodeURIComponent(required('templateId'))}`;
			if (operation === 'get') {
				return { method: 'GET', path: path() };
			}

			if (operation === 'create' || operation === 'update') {
				const body: IDataObject = {
					name: required('templateName'),
					body: required('templateBody'),
					attachmentMode: context.getNodeParameter('attachmentMode', itemIndex, 'none') as string,
				};
				const attachmentUploadId = context.getNodeParameter('attachmentUploadId', itemIndex, '') as string;
				if (attachmentUploadId !== '') {
					body.attachmentUploadId = attachmentUploadId;
				}
				return operation === 'create'
					? { method: 'POST', path: '/templates', body }
					: { method: 'PUT', path: path(), body };
			}
			break;
		}

		case 'account':
			if (operation === 'get') {
				return { method: 'GET', path: '/account' };
			}
			break;

		case 'device': {
			const deviceId = required('deviceId');

			if (operation === 'list') {
				return { method: 'GET', path: '/devices' };
			}
			if (operation === 'get') {
				return { method: 'GET', path: `/devices/${deviceId}` };
			}
			if (operation === 'sendMessage') {
				return {
					method: 'POST',
					path: `/devices/${deviceId}/messages`,
					body: { phone: required('phone'), message: required('message') },
					idempotencyKey: required('idempotencyKey'),
				};
			}
			if (operation === 'setPresence') {
				return {
					method: 'POST',
					path: `/devices/${deviceId}/presence`,
					body: { type: required('presence') },
				};
			}
			break;
		}

		case 'webhook': {
			if (operation === 'deliveries') {
				const qs: Record<string, string | number> = {};
				const deviceId = context.getNodeParameter('deviceId', itemIndex, '') as string;
				if (deviceId !== '') {
					qs.deviceId = deviceId;
				}
				qs.limit = context.getNodeParameter('limit', itemIndex, 25) as number;
				qs.offset = context.getNodeParameter('offset', itemIndex, 0) as number;
				return { method: 'GET', path: '/webhook-deliveries', qs };
			}

			const deviceId = required('deviceId');
			const path = `/devices/${deviceId}/webhook`;

			if (operation === 'get') {
				return { method: 'GET', path };
			}
			if (operation === 'set') {
				return {
					method: 'POST',
					path,
					body: {
						url: required('url'),
						events: context.getNodeParameter('events', itemIndex, []) as string[],
						active: context.getNodeParameter('active', itemIndex, true) as boolean,
					},
				};
			}
			if (operation === 'remove') {
				return { method: 'DELETE', path };
			}
			break;
		}
	}

	throw new NodeOperationError(
		context.getNode(),
		`The operation "${operation}" is not supported for the resource "${resource}"`,
		{ itemIndex },
	);
}

async function executeOperation(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const credentials = await context.getCredentials<MauKirimCredentials>('mauKirimApi');
	const call = buildOperation(context, itemIndex);
	const httpRequest: HttpRequestFn = async (options) => context.helpers.httpRequest(options);

	return request<IDataObject>({
		httpRequest,
		baseUrl: credentials.baseUrl ? credentials.baseUrl : DEFAULT_BASE_URL,
		apiKey: credentials.apiKey,
		...call,
	});
}

export class MauKirim implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'MauKirim',
		name: 'mauKirim',
		icon: { light: 'file:maukirim.svg', dark: 'file:maukirim-dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send WhatsApp OTP codes and templated notifications, and operate rented MauKirim numbers',
		defaults: {
			name: 'MauKirim',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'mauKirimApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Account',
						value: 'account',
						description: 'Read the account, credit balance and key scopes',
					},
					{
						name: 'Device',
						value: 'device',
						description: 'Operate a WhatsApp number rented from MauKirim',
					},
					{
						name: 'Notification',
						value: 'notification',
						description: 'Send a templated notification from a shared MauKirim number',
					},
					{
						name: 'OTP',
						value: 'otp',
						description: 'Send and verify a one-time passcode over WhatsApp',
					},
					{
						name: 'Template',
						value: 'template',
						description: 'List, read, propose and edit notification templates',
					},
					{
						name: 'Webhook',
						value: 'webhook',
						description: 'Manage where a rented number forwards its events',
					},
				],
				default: 'otp',
			},

			// OTP
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['otp'] } },
				options: [
					{
						name: 'Send',
						value: 'send',
						action: 'Send an OTP code',
						description: 'Send a six-digit verification code to a phone number',
					},
					{
						name: 'Verify',
						value: 'verify',
						action: 'Verify an OTP code',
						description: 'Check a code against the challenge it was issued for',
					},
				],
				default: 'send',
			},
			{
				displayName: 'Phone Number',
				name: 'phone',
				type: 'string',
				default: '',
				required: true,
				placeholder: '+628123456789',
				displayOptions: { show: { resource: ['otp'], operation: ['send'] } },
				description: 'Recipient phone number in E.164 format',
			},
			{
				displayName: 'Purpose',
				name: 'purpose',
				type: 'options',
				required: true,
				default: 'login',
				displayOptions: { show: { resource: ['otp'], operation: ['send'] } },
				options: [
					{ name: 'Login', value: 'login' },
					{ name: 'Password Reset', value: 'passwordReset' },
					{ name: 'Payment', value: 'payment' },
					{ name: 'Phone Change', value: 'phoneChange' },
					{ name: 'Sign Up', value: 'signup' },
				],
				description: 'Why the code is being sent. It is part of the idempotency fingerprint.',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. order-1234-login',
				displayOptions: { show: { resource: ['otp'], operation: ['send'] } },
				description:
					'Unique key of at most 128 characters. Repeating it with the same phone and purpose replays the original result instead of sending a second code.',
			},
			{
				displayName: 'Challenge ID',
				name: 'challengeId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['otp'], operation: ['verify'] } },
				description: 'Challenge ID returned by the send operation',
			},
			{
				displayName: 'Code',
				name: 'code',
				type: 'string',
				default: '',
				required: true,
				placeholder: '123456',
				displayOptions: { show: { resource: ['otp'], operation: ['verify'] } },
				description: 'Six-digit code the recipient received. A wrong guess consumes one of five attempts.',
			},

			// Notification
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['notification'] } },
				options: [
					{
						name: 'Get Receipt Webhook',
						value: 'getReceiptWebhook',
						action: 'Get the receipt webhook',
						description: 'Read where delivered and read receipts are sent',
					},
					{
						name: 'Remove Receipt Webhook',
						value: 'removeReceiptWebhook',
						action: 'Remove the receipt webhook',
						description: 'Delete the receipt destination and its delivery log',
					},
					{
						name: 'Rotate Receipt Webhook Secret',
						value: 'rotateReceiptWebhook',
						action: 'Rotate the receipt webhook secret',
						description: 'Issue a new signing secret; the old one stops verifying immediately',
					},
					{
						name: 'Send',
						value: 'send',
						action: 'Send a notification',
						description: 'Send an approved template from a shared MauKirim number',
					},
					{
						name: 'Set Receipt Webhook',
						value: 'setReceiptWebhook',
						action: 'Set the receipt webhook',
						description: 'Create or update where delivered and read receipts are sent. The signing secret is returned only on creation.',
					},
				],
				default: 'send',
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://example.com/maukirim/receipts',
				displayOptions: { show: { resource: ['notification'], operation: ['setReceiptWebhook'] } },
				description: 'HTTPS destination on a public host, without credentials, query or fragment',
			},
			{
				displayName: 'Active',
				name: 'active',
				type: 'boolean',
				default: true,
				displayOptions: { show: { resource: ['notification'], operation: ['setReceiptWebhook'] } },
				description: 'Whether MauKirim sends receipts to this destination',
			},
			{
				displayName: 'Phone Number',
				name: 'phone',
				type: 'string',
				default: '',
				required: true,
				placeholder: '+628123456789',
				displayOptions: { show: { resource: ['notification'], operation: ['send'] } },
				description: 'Recipient phone number in E.164 format',
			},
			{
				displayName: 'Template ID',
				name: 'templateId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['notification'], operation: ['send'] } },
				description: 'ID of an approved notification template',
			},
			{
				displayName: 'Variables',
				name: 'variables',
				type: 'json',
				default: '{}',
				displayOptions: { show: { resource: ['notification'], operation: ['send'] } },
				description:
					'JSON object whose keys must equal the top-level placeholder names of the template. A list placeholder takes an array of items.',
			},
			{
				displayName: 'Attachment Upload ID',
				name: 'attachmentUploadId',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['notification'], operation: ['send'] } },
				description:
					'Optional media ID returned by POST /messages/media. Only per-send templates accept an attachment.',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. invoice-9001',
				displayOptions: { show: { resource: ['notification'], operation: ['send'] } },
				description:
					'Unique key of at most 128 characters. Repeating it with the same template, phone and variables replays the original result instead of sending a second notification.',
			},

			// Device
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['device'] } },
				options: [
					{
						name: 'List',
						value: 'list',
						action: 'List rented numbers',
						description: 'List every number this account rents',
					},
					{
						name: 'Get',
						value: 'get',
						action: 'Get a rented number',
						description: 'Get one rented number with its rental and webhook settings',
					},
					{
						name: 'Send Message',
						value: 'sendMessage',
						action: 'Send a message from a rented number',
						description: 'Send a text message from a rented number to one recipient',
					},
					{
						name: 'Set Presence',
						value: 'setPresence',
						action: 'Set the presence of a rented number',
						description: 'Show the rented number as available or unavailable',
					},
				],
				default: 'list',
			},
			{
				displayName: 'Device ID',
				name: 'deviceId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['device', 'webhook'],
						operation: ['get', 'sendMessage', 'setPresence', 'set', 'remove'],
					},
				},
				description: 'ID of the rented number, as returned by the list operation',
			},
			{
				displayName: 'Phone Number',
				name: 'phone',
				type: 'string',
				default: '',
				required: true,
				placeholder: '+628123456789',
				displayOptions: { show: { resource: ['device'], operation: ['sendMessage'] } },
				description: 'Recipient phone number in E.164 format',
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				default: '',
				required: true,
				typeOptions: { rows: 4 },
				displayOptions: { show: { resource: ['device'], operation: ['sendMessage'] } },
				description: 'Text of the message, at most 4096 characters',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. followup-77',
				displayOptions: { show: { resource: ['device'], operation: ['sendMessage'] } },
				description:
					'Unique key of at most 128 characters. Repeating it with the same recipient and text replays the original result instead of sending a second message.',
			},
			{
				displayName: 'Presence',
				name: 'presence',
				type: 'options',
				required: true,
				default: 'available',
				displayOptions: { show: { resource: ['device'], operation: ['setPresence'] } },
				options: [
					{ name: 'Available', value: 'available' },
					{ name: 'Unavailable', value: 'unavailable' },
				],
				description: 'Presence to show for the rented number',
			},

			// Webhook
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['webhook'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						action: 'Get the webhook of a rented number',
						description: 'Read the webhook destination and its available events',
					},
					{
						name: 'Set',
						value: 'set',
						action: 'Set the webhook of a rented number',
						description: 'Create or update the destination a rented number forwards its events to',
					},
					{
						name: 'Remove',
						value: 'remove',
						action: 'Remove the webhook of a rented number',
						description: 'Delete the destination and its delivery log',
					},
					{
						name: 'List Deliveries',
						value: 'deliveries',
						action: 'List webhook deliveries',
						description: 'List what MauKirim forwarded, and what the destination answered',
					},
				],
				default: 'get',
			},
			{
				displayName: 'Device ID',
				name: 'deviceId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['webhook'], operation: ['get'] } },
				description: 'ID of the rented number whose webhook to read',
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://example.com/maukirim',
				displayOptions: { show: { resource: ['webhook'], operation: ['set'] } },
				description:
					'HTTPS destination. The host must be public: no credentials, query, fragment, IP literal, or localhost.',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				default: [],
				displayOptions: { show: { resource: ['webhook'], operation: ['set'] } },
				options: WEBHOOK_EVENTS.map((event) => ({ name: event, value: event })),
				description: 'Events to forward. Leaving this empty subscribes to every event.',
			},
			{
				displayName: 'Active',
				name: 'active',
				type: 'boolean',
				default: true,
				displayOptions: { show: { resource: ['webhook'], operation: ['set'] } },
				description: 'Whether MauKirim forwards events to this destination',
			},
			{
				displayName: 'Device ID',
				name: 'deviceId',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['webhook'], operation: ['deliveries'] } },
				description: 'Optional device ID to restrict the deliveries to. Leave empty for every number.',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1, maxValue: 100 },
				displayOptions: { show: { resource: ['webhook'], operation: ['deliveries'] } },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Offset',
				name: 'offset',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0 },
				displayOptions: { show: { resource: ['webhook'], operation: ['deliveries'] } },
				description: 'Number of deliveries to skip',
			},

			// Template
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['template'] } },
				options: [
					{
						name: 'List',
						value: 'list',
						action: 'List templates',
						description: 'List the account templates and the shared system templates, with their variables',
					},
					{
						name: 'Get',
						value: 'get',
						action: 'Get a template',
						description: 'Get one template with its variables and review status',
					},
					{
						name: 'Create',
						value: 'create',
						action: 'Propose a template',
						description: 'Propose a template for review. It cannot be sent until approved.',
					},
					{
						name: 'Update',
						value: 'update',
						action: 'Update a template',
						description: 'Replace a template this account owns. It goes back to review.',
					},
				],
				default: 'list',
			},
			{
				displayName: 'Template ID',
				name: 'templateId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['template'], operation: ['get', 'update'] } },
				description: 'ID of the template, as returned by the list operation',
			},
			{
				displayName: 'Name',
				name: 'templateName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['template'], operation: ['create', 'update'] } },
				description: 'Display name, 1 to 64 characters',
			},
			{
				displayName: 'Body',
				name: 'templateBody',
				type: 'string',
				default: '',
				required: true,
				typeOptions: { rows: 4 },
				placeholder: 'Hi {{customer_first_name}}, order {{order_number}} has shipped.',
				displayOptions: { show: { resource: ['template'], operation: ['create', 'update'] } },
				description: 'Message text, 1 to 1024 characters, with {{lower_snake}} placeholders',
			},
			{
				displayName: 'Attachment Mode',
				name: 'attachmentMode',
				type: 'options',
				default: 'none',
				displayOptions: { show: { resource: ['template'], operation: ['create', 'update'] } },
				options: [
					{ name: 'None', value: 'none' },
					{ name: 'Per Send', value: 'per_send' },
					{ name: 'Static', value: 'static' },
				],
				description: 'Whether messages carry no file, a file chosen per send, or the same file every time',
			},
			{
				displayName: 'Attachment Upload ID',
				name: 'attachmentUploadId',
				type: 'string',
				default: '',
				displayOptions: {
					show: { resource: ['template'], operation: ['create', 'update'], attachmentMode: ['static'] },
				},
				description: 'Media ID returned by POST /messages/media, sent with every message of a static template',
			},

			// Account
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['account'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						action: 'Get the account',
						description: 'Get the account, credit balance, plan, usage and the scopes of the API key',
					},
				],
				default: 'get',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const response = await executeOperation(this, itemIndex);
				returnData.push(...this.helpers.returnJsonArray(response));
			} catch (error) {
				throw classifyFailure(error, this.getNode(), itemIndex);
			}
		}

		return [returnData];
	}
}
