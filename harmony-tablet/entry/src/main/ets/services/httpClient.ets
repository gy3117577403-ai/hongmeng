import http from '@ohos.net.http';
import { API_BASE_URL, API_TIMEOUT_MS } from '../constants/api';
import type { PickedFile } from '../platform/FilePickerAdapter';

export interface NativeApiBaseResponse {
  ok: boolean;
  error?: string;
}

export interface HttpHeaders {
  Accept: string;
  contentType: string;
  Authorization?: string;
}

export interface HttpRequestOptions {
  contentType: string;
  bodyText: string;
}

export interface HttpResponseText {
  status: number;
  text: string;
}

export interface MultipartUploadInput {
  workOrderId: string;
  categoryId: string;
  fileFieldName: string;
  file: PickedFile;
}

export class ApiException extends Error {
  status: number;
  needLogin: boolean;

  constructor(message: string, status: number = 0, needLogin: boolean = false) {
    super(message);
    this.status = status;
    this.needLogin = needLogin;
  }
}

class NativeHttpClient {
  private token: string = '';

  setToken(token: string): void {
    this.token = token;
  }

  clearToken(): void {
    this.token = '';
  }

  async get(path: string): Promise<HttpResponseText> {
    return this.request('GET', path);
  }

  async post(path: string, bodyText: string = ''): Promise<HttpResponseText> {
    const options: HttpRequestOptions = {
      contentType: 'application/json',
      bodyText: bodyText
    };
    return this.request('POST', path, options);
  }

  async patch(path: string, bodyText: string = ''): Promise<HttpResponseText> {
    const options: HttpRequestOptions = {
      contentType: 'application/json',
      bodyText: bodyText
    };
    return this.request('PATCH', path, options);
  }

  async delete(path: string, bodyText: string = ''): Promise<HttpResponseText> {
    const options: HttpRequestOptions = {
      contentType: 'application/json',
      bodyText: bodyText
    };
    return this.request('DELETE', path, options);
  }

  async uploadMultipart(path: string, input: MultipartUploadInput): Promise<HttpResponseText> {
    throw new ApiException('原生上传能力待 DevEco 真机适配', 0);
  }

  contentUrl(path: string): string {
    return `${API_BASE_URL}${path}`;
  }

  private async request(method: string, path: string, options?: HttpRequestOptions): Promise<HttpResponseText> {
    const client = http.createHttp();
    const headers: HttpHeaders = {
      Accept: 'application/json',
      contentType: ''
    };
    if (options && options.contentType.length > 0) {
      headers.contentType = options.contentType;
    }
    if (this.token.length > 0) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    try {
      const response = await client.request(`${API_BASE_URL}${path}`, {
        method: this.method(method),
        header: headers,
        extraData: options ? options.bodyText : undefined,
        connectTimeout: API_TIMEOUT_MS,
        readTimeout: API_TIMEOUT_MS
      });
      const status = Number(response.responseCode || 0);
      const text = typeof response.result === 'string' ? response.result : JSON.stringify(response.result || {});
      this.raiseIfFailed(status, text);
      const result: HttpResponseText = {
        status: status,
        text: text
      };
      return result;
    } catch (err) {
      if (err instanceof ApiException) {
        throw err;
      }
      throw new ApiException('网络连接失败，请检查平板网络');
    } finally {
      client.destroy();
    }
  }

  private raiseIfFailed(status: number, text: string): void {
    const parsed = this.parseBaseResponse(text, status);
    if (status === 401) {
      throw new ApiException(parsed.error || '未登录或登录已过期', 401, true);
    }
    if (status === 403) {
      throw new ApiException(parsed.error || '没有访问权限', 403);
    }
    if (status === 404) {
      throw new ApiException(parsed.error || '资源不存在', 404);
    }
    if (status >= 500) {
      throw new ApiException(parsed.error || '服务端异常', status);
    }
    if (!parsed.ok) {
      throw new ApiException(parsed.error || '请求失败', status);
    }
  }

  private parseBaseResponse(text: string, status: number): NativeApiBaseResponse {
    try {
      return JSON.parse(text) as NativeApiBaseResponse;
    } catch (_) {
      throw new ApiException('服务返回格式异常', status);
    }
  }

  private method(method: string): http.RequestMethod {
    if (method === 'POST') return http.RequestMethod.POST;
    if (method === 'PATCH') return http.RequestMethod.PATCH;
    if (method === 'DELETE') return http.RequestMethod.DELETE;
    return http.RequestMethod.GET;
  }
}

export const httpClient = new NativeHttpClient();
