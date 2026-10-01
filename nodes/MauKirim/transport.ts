import { IDataObject } from 'n8n-workflow';

/**
 * The HTTP verb of a MauKirim API call.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * The subset of an n8n HTTP request this client needs. Keeping the type local
 * keeps this module free of any n8n import and unit-testable without a network.
 */
export interface HttpRequestOptions {
	method: HttpMethod;
	url: string;
	headers: Record<string, string>;
	qs?: Record<string, string | number>;
	body?: IDataObject;
	json: boolean;
	ignoreHttpStatusErrors: boolean;
}

export type HttpRequestFn = (options: HttpRequestOptions) => Promise<unknown>;

/**
 * A failed MauKirim call: the API answered with the documented
 * `{ ok: false, code }` envelope. `code` is the raw API code.
 */
export class MauKirimApiError extends Error {
	readonly code: string;

	constructor(code: string, message: string = `MauKirim API error: ${code}`) {
		super(message);
		this.name = 'MauKirimApiError';
		this.code = code;
	}
}

export interface RequestOptions {
	httpRequest: HttpRequestFn;
	baseUrl: string;
	apiKey: string;
	method: HttpMethod;
	path: string;
	body?: IDataObject;
	idempotencyKey?: string;
	qs?: Record<string, string | number>;
}

interface FailedEnvelope {
	ok: false;
	code?: unknown;
}

function isFailedEnvelope(response: unknown): response is FailedEnvelope {
	return typeof response === 'object' && response !== null && (response as { ok?: unknown }).ok === false;
}

/**
 * Performs one MauKirim API call and returns its parsed success envelope.
 *
 * A non-2xx response is not raised by the HTTP layer (`ignoreHttpStatusErrors`)
 * so the documented error envelope can be read and surfaced as a
 * {@link MauKirimApiError} carrying the API code.
 */
export async function request<T = IDataObject>(options: RequestOptions): Promise<T> {
	const { httpRequest, baseUrl, apiKey, method, path, body, idempotencyKey, qs } = options;

	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiKey}`,
	};

	if (body !== undefined) {
		headers['Content-Type'] = 'application/json';
	}

	if (idempotencyKey !== undefined) {
		headers['Idempotency-Key'] = idempotencyKey;
	}

	const response = await httpRequest({
		method,
		url: `${baseUrl.replace(/\/+$/, '')}${path}`,
		headers,
		...(body !== undefined ? { body } : {}),
		...(qs !== undefined ? { qs } : {}),
		json: true,
		ignoreHttpStatusErrors: true,
	});

	if (isFailedEnvelope(response)) {
		const code =
			typeof response.code === 'string' && response.code.length > 0 ? response.code : 'unknown_error';
		throw new MauKirimApiError(code);
	}

	return response as T;
}
