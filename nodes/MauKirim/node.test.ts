import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';

import { MauKirim } from './MauKirim.node';
import { HttpRequestOptions } from './transport';

const BASE = 'https://app.maukirim.com/api/v1';
const node = new MauKirim();

type ParameterValue = unknown;
type Parameters = Record<string, ParameterValue | ((itemIndex: number) => unknown)>;

function makeContext(
	parameters: Parameters,
	calls: HttpRequestOptions[],
	response: unknown,
	inputItemCount = 1,
): IExecuteFunctions {
	const inputItems: INodeExecutionData[] = Array.from({ length: inputItemCount }, () => ({ json: {} }));

	return {
		getNode: () => ({
			id: '1',
			name: 'MauKirim',
			type: 'n8n-nodes-maukirim.mauKirim',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		getInputData: () => inputItems,
		getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) => {
			const value = parameters[name];
			if (typeof value === 'function') return value(itemIndex);
			return value === undefined ? fallback : value;
		},
		getCredentials: async () => ({ apiKey: 'mk_live_test', baseUrl: BASE }),
		helpers: {
			httpRequest: async (options: HttpRequestOptions) => {
				calls.push(options);
				if (response instanceof Error) throw response;
				return response;
			},
			returnJsonArray: (data: IDataObject | IDataObject[]) =>
				Array.isArray(data) ? data.map((json) => ({ json })) : [{ json: data }],
		},
	} as unknown as IExecuteFunctions;
}

interface RunResult {
	items: INodeExecutionData[];
	calls: HttpRequestOptions[];
}

async function run(
	parameters: Parameters,
	response: unknown = { ok: true },
	inputItemCount = 1,
): Promise<RunResult> {
	const calls: HttpRequestOptions[] = [];
	const context = makeContext(parameters, calls, response, inputItemCount);
	const output = await node.execute.call(context);
	return { items: output[0], calls };
}

function property(name: string): INodeProperties {
	const found = node.description.properties.find((candidate) => candidate.name === name);
	if (found === undefined) throw new Error(`No node property named ${name}`);
	return found;
}

function optionValues(properties: INodeProperties): unknown[] {
	return ((properties.options ?? []) as Array<{ value: unknown }>).map((option) => option.value);
}

function optionNames(properties: INodeProperties): string[] {
	return ((properties.options ?? []) as Array<{ name: string }>).map((option) => option.name);
}

function operationProperty(resource: string): INodeProperties {
	const matches = node.description.properties.filter(
		(candidate) =>
			candidate.name === 'operation' &&
			((candidate.displayOptions?.show?.resource ?? []) as string[]).includes(resource),
	);
	expect(matches).toHaveLength(1);
	return matches[0];
}

describe('MauKirim credentials', () => {
	it('requires the mauKirimApi credential', () => {
		expect(node.description.credentials).toEqual([{ name: 'mauKirimApi', required: true }]);
	});
});

describe('MauKirim description', () => {
	it('is the MauKirim node with a single main input and output', () => {
		expect(node.description.displayName).toBe('MauKirim');
		expect(node.description.name).toBe('mauKirim');
		expect(node.description.defaults).toEqual({ name: 'MauKirim' });
		expect(node.description.inputs).toEqual([NodeConnectionTypes.Main]);
		expect(node.description.outputs).toEqual([NodeConnectionTypes.Main]);
	});

	// n8n requires themed variants; the files themselves are checked by scripts/verify-assets.mjs,
	// because a community node may not import node:fs (n8n Cloud disallows it).
	it('declares light and dark icon variants, so n8n renders the node in both themes', () => {
		expect(node.description.icon).toEqual({
			light: 'file:maukirim.svg',
			dark: 'file:maukirim-dark.svg',
		});
	});

	it('orders the attachment mode options alphabetically by name, as n8n requires', () => {
		const names = optionNames(property('attachmentMode'));
		expect(names).toEqual([...names].sort());
		expect(optionValues(property('attachmentMode'))).toEqual(['none', 'per_send', 'static']);
	});

	it('limits the OTP purpose to the documented enum', () => {
		expect([...optionValues(property('purpose'))].sort()).toEqual([
			'login',
			'passwordReset',
			'payment',
			'phoneChange',
			'signup',
		]);
	});

	it('orders the OTP purpose options alphabetically by name, as n8n requires', () => {
		const names = optionNames(property('purpose'));
		expect(names).toEqual([...names].sort());
		expect(names).toEqual(['Login', 'Password Reset', 'Payment', 'Phone Change', 'Sign Up']);
	});

	it('limits the presence to the documented enum', () => {
		expect(optionValues(property('presence'))).toEqual(['available', 'unavailable']);
	});

	it('lists every documented webhook event', () => {
		expect(property('events').type).toBe('multiOptions');
		expect(optionValues(property('events'))).toEqual([
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
		]);
	});

	it('takes the notification variables as a JSON parameter', () => {
		expect(property('variables').type).toBe('json');
	});

	it('requires every field the API requires', () => {
		expect(property('phone').required).toBe(true);
		expect(property('challengeId').required).toBe(true);
		expect(property('code').required).toBe(true);
		expect(property('templateId').required).toBe(true);
		expect(property('message').required).toBe(true);
		expect(property('url').required).toBe(true);
		expect(property('idempotencyKey').required).toBe(true);
	});
});

describe('MauKirim node package manifest', () => {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const manifest = require('../../package.json') as {
		name: string;
		keywords: string[];
		files: string[];
		peerDependencies: Record<string, string>;
		n8n: { n8nNodesApiVersion: number; credentials: string[]; nodes: string[] };
	};

	it('is published as an n8n community node package', () => {
		expect(manifest.name).toBe('n8n-nodes-maukirim');
		expect(manifest.keywords).toContain('n8n-community-node-package');
		expect(manifest.files).toEqual(['dist']);
		expect(manifest.peerDependencies['n8n-workflow']).toBe('*');
	});

	it('registers the built credential and node files with n8n', () => {
		expect(manifest.n8n.n8nNodesApiVersion).toBe(1);
		expect(manifest.n8n.credentials).toEqual(['dist/credentials/MauKirimApi.credentials.js']);
		expect(manifest.n8n.nodes).toEqual(['dist/nodes/MauKirim/MauKirim.node.js']);
	});
});

describe('MauKirim execute', () => {
	const otpSendResponse = {
		ok: true,
		challengeId: 'ch_1',
		batchId: 'batch_1',
		expiresAt: '2026-01-01T00:00:00.000Z',
	};

	it('sends an OTP and returns the challenge', async () => {
		const { items, calls } = await run(
			{
				resource: 'otp',
				operation: 'send',
				phone: '+628123456789',
				purpose: 'login',
				idempotencyKey: 'idem-otp-1',
			},
			otpSendResponse,
		);

		expect(items).toEqual([{ json: otpSendResponse }]);
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('POST');
		expect(calls[0].url).toBe(`${BASE}/otp/send`);
		expect(calls[0].headers.Authorization).toBe('Bearer mk_live_test');
		expect(calls[0].headers['Content-Type']).toBe('application/json');
		expect(calls[0].headers['Idempotency-Key']).toBe('idem-otp-1');
		expect(calls[0].body).toEqual({ phone: '+628123456789', purpose: 'login' });
	});

	it('verifies an OTP without an idempotency key', async () => {
		const { items, calls } = await run(
			{ resource: 'otp', operation: 'verify', challengeId: 'ch_1', code: '123456' },
			{ ok: true, verified: true },
		);

		expect(items).toEqual([{ json: { ok: true, verified: true } }]);
		expect(calls[0].method).toBe('POST');
		expect(calls[0].url).toBe(`${BASE}/otp/verify`);
		expect(calls[0].headers['Idempotency-Key']).toBeUndefined();
		expect(calls[0].body).toEqual({ challengeId: 'ch_1', code: '123456' });
	});

	it('sends a notification with parsed variables and no attachment', async () => {
		const response = { ok: true, batchId: 'batch_2' };
		const { items, calls } = await run(
			{
				resource: 'notification',
				operation: 'send',
				phone: '+628123456789',
				templateId: 'tpl_1',
				variables: '{"name":"Budi","items":[{"sku":"A1","qty":"2"}]}',
				idempotencyKey: 'idem-notify-1',
			},
			response,
		);

		expect(items).toEqual([{ json: response }]);
		expect(calls[0].method).toBe('POST');
		expect(calls[0].url).toBe(`${BASE}/messages/send`);
		expect(calls[0].headers['Idempotency-Key']).toBe('idem-notify-1');
		expect(calls[0].body).toEqual({
			phone: '+628123456789',
			templateId: 'tpl_1',
			variables: { name: 'Budi', items: [{ sku: 'A1', qty: '2' }] },
		});
	});

	it('sends a notification attachment id when one is given', async () => {
		const { calls } = await run(
			{
				resource: 'notification',
				operation: 'send',
				phone: '+628123456789',
				templateId: 'tpl_1',
				variables: '{}',
				attachmentUploadId: 'media_1',
				idempotencyKey: 'idem-notify-2',
			},
			{ ok: true, batchId: 'batch_2' },
		);

		expect(calls[0].body).toEqual({
			phone: '+628123456789',
			templateId: 'tpl_1',
			variables: {},
			attachmentUploadId: 'media_1',
		});
	});

	it('reports malformed notification variables as a node error', async () => {
		const error = await run({
			resource: 'notification',
			operation: 'send',
			phone: '+628123456789',
			templateId: 'tpl_1',
			variables: '{not json',
			idempotencyKey: 'idem-notify-3',
		}).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect((error as Error).message).toMatch(/variables/i);
	});

	it('manages the notification receipt webhook', async () => {
		const get = await run({ resource: 'notification', operation: 'getReceiptWebhook' });
		expect(get.calls[0].method).toBe('GET');
		expect(get.calls[0].url).toBe(`${BASE}/notifications/webhook`);
		expect(get.calls[0].body).toBeUndefined();

		const set = await run({
			resource: 'notification',
			operation: 'setReceiptWebhook',
			url: 'https://example.com/receipts',
			active: false,
		});
		expect(set.calls[0].method).toBe('POST');
		expect(set.calls[0].url).toBe(`${BASE}/notifications/webhook`);
		expect(set.calls[0].body).toEqual({ url: 'https://example.com/receipts', active: false });

		const rotate = await run({ resource: 'notification', operation: 'rotateReceiptWebhook' });
		expect(rotate.calls[0].method).toBe('PUT');

		const remove = await run({ resource: 'notification', operation: 'removeReceiptWebhook' });
		expect(remove.calls[0].method).toBe('DELETE');
		expect(remove.calls[0].url).toBe(`${BASE}/notifications/webhook`);
	});

	it('lists templates', async () => {
		const response = { ok: true, templates: [{ id: 'shopify_order_paid_en', variables: ['order_number'] }] };
		const { items, calls } = await run({ resource: 'template', operation: 'list' }, response);

		expect(items).toEqual([{ json: response }]);
		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toBe(`${BASE}/templates`);
	});

	it('gets one template, escaping its id', async () => {
		const { calls } = await run({ resource: 'template', operation: 'get', templateId: 'tpl/1' });

		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toBe(`${BASE}/templates/tpl%2F1`);
	});

	it('proposes a template without an attachment upload id when none is given', async () => {
		const { calls } = await run({
			resource: 'template',
			operation: 'create',
			templateName: 'Shipped',
			templateBody: 'Order {{order_number}} shipped.',
		});

		expect(calls[0].method).toBe('POST');
		expect(calls[0].url).toBe(`${BASE}/templates`);
		expect(calls[0].body).toEqual({
			name: 'Shipped',
			body: 'Order {{order_number}} shipped.',
			attachmentMode: 'none',
		});
	});

	it('updates a static template with its attachment', async () => {
		const { calls } = await run({
			resource: 'template',
			operation: 'update',
			templateId: 'tpl_1',
			templateName: 'Invoice',
			templateBody: 'Invoice {{order_number}}',
			attachmentMode: 'static',
			attachmentUploadId: 'media_1',
		});

		expect(calls[0].method).toBe('PUT');
		expect(calls[0].url).toBe(`${BASE}/templates/tpl_1`);
		expect(calls[0].body).toEqual({
			name: 'Invoice',
			body: 'Invoice {{order_number}}',
			attachmentMode: 'static',
			attachmentUploadId: 'media_1',
		});
	});

	it('reads the account', async () => {
		const response = { ok: true, balance: { credits: 600, currency: 'IDR' }, scopes: ['read'] };
		const { items, calls } = await run({ resource: 'account', operation: 'get' }, response);

		expect(items).toEqual([{ json: response }]);
		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toBe(`${BASE}/account`);
	});

	it('lists devices', async () => {
		const response = {
			ok: true,
			devices: [{ id: 'dev_123', label: 'Sales', number: '+628111', status: 'active' }],
		};
		const { items, calls } = await run({ resource: 'device', operation: 'list' }, response);

		expect(items).toEqual([{ json: response }]);
		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toBe(`${BASE}/devices`);
		expect(calls[0].headers['Idempotency-Key']).toBeUndefined();
		expect(calls[0].body).toBeUndefined();
	});

	it('gets one device', async () => {
		const response = { ok: true, device: { id: 'dev_123' }, rental: {}, webhook: null };
		const { items, calls } = await run(
			{ resource: 'device', operation: 'get', deviceId: 'dev_123' },
			response,
		);

		expect(items).toEqual([{ json: response }]);
		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toBe(`${BASE}/devices/dev_123`);
		expect(calls[0].body).toBeUndefined();
	});

	it('sends a message from a rented number', async () => {
		const response = {
			ok: true,
			batchId: 'batch_3',
			created: true,
			progress: { batchId: 'batch_3', total: 1, terminal: false, items: [] },
		};
		const { items, calls } = await run(
			{
				resource: 'device',
				operation: 'sendMessage',
				deviceId: 'dev_123',
				phone: '+628123456789',
				message: 'Halo',
				idempotencyKey: 'idem-msg-1',
			},
			response,
		);

		expect(items).toEqual([{ json: response }]);
		expect(calls[0].method).toBe('POST');
		expect(calls[0].url).toBe(`${BASE}/devices/dev_123/messages`);
		expect(calls[0].headers['Idempotency-Key']).toBe('idem-msg-1');
		expect(calls[0].body).toEqual({ phone: '+628123456789', message: 'Halo' });
	});

	it('sets the presence of a rented number', async () => {
		const { items, calls } = await run(
			{ resource: 'device', operation: 'setPresence', deviceId: 'dev_123', presence: 'available' },
			{ ok: true, type: 'available' },
		);

		expect(items).toEqual([{ json: { ok: true, type: 'available' } }]);
		expect(calls[0].method).toBe('POST');
		expect(calls[0].url).toBe(`${BASE}/devices/dev_123/presence`);
		expect(calls[0].headers['Idempotency-Key']).toBeUndefined();
		expect(calls[0].body).toEqual({ type: 'available' });
	});

	it('gets the webhook of a rented number', async () => {
		const response = { ok: true, webhook: null, availableEvents: ['message'], gatewayWired: false };
		const { items, calls } = await run(
			{ resource: 'webhook', operation: 'get', deviceId: 'dev_123' },
			response,
		);

		expect(items).toEqual([{ json: response }]);
		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toBe(`${BASE}/devices/dev_123/webhook`);
		expect(calls[0].body).toBeUndefined();
	});

	it('sets the webhook of a rented number', async () => {
		const response = {
			ok: true,
			webhook: {
				id: 'wh_1',
				deviceId: 'dev_123',
				url: 'https://example.com/hook',
				events: ['message', 'message.ack'],
				active: true,
			},
			secret: 'a'.repeat(64),
		};
		const { items, calls } = await run(
			{
				resource: 'webhook',
				operation: 'set',
				deviceId: 'dev_123',
				url: 'https://example.com/hook',
				events: ['message', 'message.ack'],
				active: true,
			},
			response,
		);

		expect(items).toEqual([{ json: response }]);
		expect(calls[0].method).toBe('POST');
		expect(calls[0].url).toBe(`${BASE}/devices/dev_123/webhook`);
		expect(calls[0].headers['Idempotency-Key']).toBeUndefined();
		expect(calls[0].body).toEqual({
			url: 'https://example.com/hook',
			events: ['message', 'message.ack'],
			active: true,
		});
	});

	it('removes the webhook of a rented number', async () => {
		const { items, calls } = await run(
			{ resource: 'webhook', operation: 'remove', deviceId: 'dev_123' },
			{ ok: true, removed: true },
		);

		expect(items).toEqual([{ json: { ok: true, removed: true } }]);
		expect(calls[0].method).toBe('DELETE');
		expect(calls[0].url).toBe(`${BASE}/devices/dev_123/webhook`);
		expect(calls[0].body).toBeUndefined();
	});

	it('defaults the deliveries limit to 50 with the description n8n requires', () => {
		const limit = property('limit');
		expect(limit.default).toBe(50);
		expect(limit.description).toBe('Max number of results to return');
	});

	it('lists webhook deliveries with the device, limit and offset', async () => {
		const response = { ok: true, deliveries: [], hasMore: false };
		const { items, calls } = await run(
			{
				resource: 'webhook',
				operation: 'deliveries',
				deviceId: 'dev_123',
				limit: 25,
				offset: 10,
			},
			response,
		);

		expect(items).toEqual([{ json: response }]);
		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toBe(`${BASE}/webhook-deliveries`);
		expect(calls[0].qs).toEqual({ deviceId: 'dev_123', limit: 25, offset: 10 });
		expect(calls[0].body).toBeUndefined();
	});

	it('omits the device from the delivery query string when none is given', async () => {
		const { calls } = await run(
			{ resource: 'webhook', operation: 'deliveries', deviceId: '', limit: 25, offset: 0 },
			{ ok: true, deliveries: [], hasMore: false },
		);

		expect(calls[0].qs).toEqual({ limit: 25, offset: 0 });
	});

	it.each<[string, Parameters]>([
		['otp.send', {}],
		['otp.verify', {}],
		['notification.send', {}],
		['device.list', {}],
		['device.get', {}],
		['device.sendMessage', {}],
		['device.setPresence', {}],
		['webhook.get', {}],
		['webhook.set', {}],
		['webhook.remove', {}],
		['webhook.deliveries', {}],
	])('sends the idempotency key only on the routes that require one (%s)', async (operation) => {
		const [resource, action] = operation.split('.');
		const { calls } = await run({
			resource,
			operation: action,
			deviceId: 'dev_123',
			phone: '+628123456789',
			purpose: 'login',
			challengeId: 'ch_1',
			code: '123456',
			templateId: 'tpl_1',
			variables: '{}',
			message: 'Halo',
			presence: 'available',
			url: 'https://example.com/hook',
			events: [],
			active: true,
			limit: 25,
			offset: 0,
			idempotencyKey: 'idem-1',
		});

		const needsIdempotency = [
			'otp.send',
			'notification.send',
			'device.sendMessage',
		].includes(operation);

		expect(calls[0].headers['Idempotency-Key']).toBe(needsIdempotency ? 'idem-1' : undefined);
	});

	it('runs once per input item, resolving the parameters of each item', async () => {
		const { items, calls } = await run(
			{
				resource: 'otp',
				operation: 'send',
				phone: (itemIndex: number) => `+6281234567${itemIndex}`,
				purpose: 'login',
				idempotencyKey: (itemIndex: number) => `idem-${itemIndex}`,
			},
			{ ok: true, challengeId: 'ch_1' },
			2,
		);

		expect(calls).toHaveLength(2);
		expect(calls.map((call) => call.headers['Idempotency-Key'])).toEqual(['idem-0', 'idem-1']);
		expect(calls.map((call) => (call.body as { phone: string }).phone)).toEqual([
			'+62812345670',
			'+62812345671',
		]);
		expect(items).toEqual([{ json: { ok: true, challengeId: 'ch_1' } }, { json: { ok: true, challengeId: 'ch_1' } }]);
	});

	it('wraps an unexpected transport failure as a NodeApiError, as n8n requires', async () => {
		const calls: HttpRequestOptions[] = [];
		const context = makeContext({ resource: 'device', operation: 'list' }, calls, new Error('socket hang up'));

		const thrown = await node.execute.call(context).catch((error: unknown) => error);

		expect(thrown).toBeInstanceOf(NodeApiError);
	});

	it('turns a failed API envelope into a node operation error carrying the code', async () => {
		const error = await run(
			{
				resource: 'otp',
				operation: 'send',
				phone: '+628123456789',
				purpose: 'login',
				idempotencyKey: 'idem-otp-1',
			},
			{ ok: false, code: 'insufficient_credits' },
		).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect((error as Error).message).toContain('insufficient_credits');
		expect((error as NodeOperationError).context?.itemIndex).toBe(0);
	});
});
