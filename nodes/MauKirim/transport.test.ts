import { MauKirimApiError, HttpMethod, HttpRequestFn, HttpRequestOptions, request } from './transport';

const BASE = 'https://app.maukirim.com/api/v1';
const API_KEY = 'mk_live_test_key';

interface Recorder {
	httpRequest: HttpRequestFn;
	calls: HttpRequestOptions[];
}

function recorder(result: unknown = { ok: true }): Recorder {
	const calls: HttpRequestOptions[] = [];
	const httpRequest: HttpRequestFn = async (options) => {
		calls.push(options);
		return result;
	};
	return { httpRequest, calls };
}

describe('request', () => {
	it('builds the URL from the base URL and the path and sends the bearer token', async () => {
		const { httpRequest, calls } = recorder({ ok: true, devices: [] });

		await request({ httpRequest, baseUrl: BASE, apiKey: API_KEY, method: 'GET', path: '/devices' });

		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toBe(`${BASE}/devices`);
		expect(calls[0].headers.Authorization).toBe(`Bearer ${API_KEY}`);
		expect(calls[0].headers['Idempotency-Key']).toBeUndefined();
		expect(calls[0].body).toBeUndefined();
		expect(calls[0].qs).toBeUndefined();
	});

	it('tolerates a trailing slash on the base URL', async () => {
		const { httpRequest, calls } = recorder();

		await request({
			httpRequest,
			baseUrl: `${BASE}/`,
			apiKey: API_KEY,
			method: 'GET',
			path: '/devices',
		});

		expect(calls[0].url).toBe(`${BASE}/devices`);
	});

	it('lets the HTTP layer surface the API error envelope instead of throwing on the status code', async () => {
		const { httpRequest, calls } = recorder();

		await request({ httpRequest, baseUrl: BASE, apiKey: API_KEY, method: 'GET', path: '/devices' });

		expect(calls[0].json).toBe(true);
		expect(calls[0].ignoreHttpStatusErrors).toBe(true);
	});

	it('sends the exact JSON body of POST /otp/send with a JSON content type', async () => {
		const { httpRequest, calls } = recorder({ ok: true, challengeId: 'ch_1' });

		await request({
			httpRequest,
			baseUrl: BASE,
			apiKey: API_KEY,
			method: 'POST',
			path: '/otp/send',
			body: { phone: '+628123456789', purpose: 'login' },
			idempotencyKey: 'idem-1',
		});

		expect(calls[0].url).toBe(`${BASE}/otp/send`);
		expect(calls[0].headers['Content-Type']).toBe('application/json');
		expect(calls[0].body).toEqual({ phone: '+628123456789', purpose: 'login' });
	});

	it('sends the Idempotency-Key header only when a key is given', async () => {
		const withKey = recorder();
		await request({
			httpRequest: withKey.httpRequest,
			baseUrl: BASE,
			apiKey: API_KEY,
			method: 'POST',
			path: '/messages/send',
			body: { phone: '+628123456789' },
			idempotencyKey: 'idem-notify-1',
		});
		expect(withKey.calls[0].headers['Idempotency-Key']).toBe('idem-notify-1');

		const withoutKey = recorder();
		await request({
			httpRequest: withoutKey.httpRequest,
			baseUrl: BASE,
			apiKey: API_KEY,
			method: 'POST',
			path: '/otp/verify',
			body: { challengeId: 'ch_1', code: '123456' },
		});
		expect(withoutKey.calls[0].headers['Idempotency-Key']).toBeUndefined();
	});

	it('keeps nested notification variables, including the variable arrays, exactly as given', async () => {
		const { httpRequest, calls } = recorder({ ok: true, batchId: 'batch_1' });

		await request({
			httpRequest,
			baseUrl: BASE,
			apiKey: API_KEY,
			method: 'POST',
			path: '/messages/send',
			body: {
				phone: '+628123456789',
				templateId: 'tpl_1',
				variables: { name: 'Budi', items: [{ sku: 'A1', qty: '2' }] },
			},
			idempotencyKey: 'idem-notify-1',
		});

		expect(calls[0].body).toEqual({
			phone: '+628123456789',
			templateId: 'tpl_1',
			variables: { name: 'Budi', items: [{ sku: 'A1', qty: '2' }] },
		});
	});

	it('passes the delivery query string through untouched', async () => {
		const { httpRequest, calls } = recorder({ ok: true, deliveries: [], hasMore: false });

		await request({
			httpRequest,
			baseUrl: BASE,
			apiKey: API_KEY,
			method: 'GET',
			path: '/webhook-deliveries',
			qs: { deviceId: 'dev_123', limit: 25, offset: 0 },
		});

		expect(calls[0].url).toBe(`${BASE}/webhook-deliveries`);
		expect(calls[0].qs).toEqual({ deviceId: 'dev_123', limit: 25, offset: 0 });
		expect(calls[0].body).toBeUndefined();
	});

	it('returns the parsed success envelope', async () => {
		const envelope = { ok: true, challengeId: 'ch_1', batchId: 'batch_1', expiresAt: '2026-01-01T00:00:00Z' };
		const { httpRequest } = recorder(envelope);

		const result = await request({
			httpRequest,
			baseUrl: BASE,
			apiKey: API_KEY,
			method: 'POST',
			path: '/otp/send',
			body: { phone: '+628123456789', purpose: 'login' },
			idempotencyKey: 'idem-1',
		});

		expect(result).toEqual(envelope);
	});

	it('throws a MauKirimApiError carrying the code of a failed envelope', async () => {
		const { httpRequest } = recorder({ ok: false, code: 'insufficient_credits' });

		const promise = request({
			httpRequest,
			baseUrl: BASE,
			apiKey: API_KEY,
			method: 'POST',
			path: '/otp/send',
			body: { phone: '+628123456789', purpose: 'login' },
			idempotencyKey: 'idem-1',
		});

		await expect(promise).rejects.toBeInstanceOf(MauKirimApiError);
		await expect(promise).rejects.toMatchObject({ code: 'insufficient_credits' });
		await expect(promise).rejects.toThrow(/insufficient_credits/);
	});

	it.each<[string, HttpMethod, string]>([
		['otp.send', 'POST', '/otp/send'],
		['otp.verify', 'POST', '/otp/verify'],
		['notification.send', 'POST', '/messages/send'],
		['device.list', 'GET', '/devices'],
		['device.get', 'GET', '/devices/dev_123'],
		['device.sendMessage', 'POST', '/devices/dev_123/messages'],
		['device.setPresence', 'POST', '/devices/dev_123/presence'],
		['webhook.get', 'GET', '/devices/dev_123/webhook'],
		['webhook.set', 'POST', '/devices/dev_123/webhook'],
		['webhook.remove', 'DELETE', '/devices/dev_123/webhook'],
		['webhook.deliveries', 'GET', '/webhook-deliveries'],
	])('builds the %s request as %s %s', async (_operation, method, path) => {
		const { httpRequest, calls } = recorder();

		await request({ httpRequest, baseUrl: BASE, apiKey: API_KEY, method, path });

		expect(calls[0].method).toBe(method);
		expect(calls[0].url).toBe(`${BASE}${path}`);
	});
});
