import http from '@ohos.net.http';
import { API_BASE_URL, API_TIMEOUT_MS } from '../constants/api';
import type { PickedFile } from '../platform/FilePickerAdapter';

export interface NativeApiBaseResponse {
  ok?: boolean;
  success?: boolean;
  error?: string;
  message?: string;
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
  statusCode: number;
  status: number;
  bodyText: string;
  text: string;
  contentType: string;
  error: string;
  path: string;
}

export interface MultipartUploadInput {
  workOrderId: string;
  categoryId: string;
  fileFieldName: string;
  file: PickedFile;
}

export class ApiException extends Error {
  status: number;
  statusCode: number;
  needLogin: boolean;
  path: string;
  contentType: string;
  bodyText: string;
  responseError: string;

  constructor(message: string, status: number = 0, needLogin: boolean = false, path: string = '', contentType: string = '', bodyText: string = '', responseError: string = '') {
    super(message);
    this.status = status;
    this.statusCode = status;
    this.needLogin = needLogin;
    this.path = path;
    this.contentType = contentType;
    this.bodyText = bodyText;
    this.responseError = responseError;
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
    throw new ApiException('当前设备暂不支持原生上传，请使用 Web 端上传。', 0);
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
      const contentType = this.detectContentType(text);
      const result: HttpResponseText = {
        statusCode: status,
        status: status,
        bodyText: text,
        text: text,
        contentType: contentType,
        error: '',
        path: path
      };
      this.raiseIfFailed(result);
      return result;
    } catch (err) {
      if (err instanceof ApiException) {
        throw err;
      }
      throw new ApiException('网络连接失败，请检查平板网络', 0, false, path);
    } finally {
      client.destroy();
    }
  }

  private raiseIfFailed(response: HttpResponseText): void {
    const status = response.statusCode;
    if (status === 401) {
      const parsed = this.tryParseBaseResponse(response.bodyText);
      const message = response.path === '/api/native/auth/login' ? '用户名或密码错误' : this.errorMessage(parsed, '未登录或登录已过期');
      throw new ApiException(message, 401, true, response.path, response.contentType, response.bodyText, message);
    }
    if (status === 403) {
      const parsed = this.tryParseBaseResponse(response.bodyText);
      const message = this.errorMessage(parsed, '没有访问权限');
      throw new ApiException(message, 403, false, response.path, response.contentType, response.bodyText, message);
    }
    if (status === 404) {
      const parsed = this.tryParseBaseResponse(response.bodyText);
      const fallback = response.path === '/api/native/auth/login' ? '登录接口不存在或服务器地址错误，请检查 API 地址' : '资源不存在';
      const message = this.errorMessage(parsed, fallback);
      throw new ApiException(message, 404, false, response.path, response.contentType, response.bodyText, message);
    }
    if (status >= 500) {
      const parsed = this.tryParseBaseResponse(response.bodyText);
      const message = this.errorMessage(parsed, '服务端异常');
      throw new ApiException(message, status, false, response.path, response.contentType, response.bodyText, message);
    }
    if (status >= 400) {
      const parsed = this.tryParseBaseResponse(response.bodyText);
      const message = this.errorMessage(parsed, '请求失败');
      throw new ApiException(message, status, false, response.path, response.contentType, response.bodyText, message);
    }

    const parsed = this.parseBaseResponse(response);
    if (parsed.ok === false || parsed.success === false) {
      const message = this.errorMessage(parsed, '请求失败');
      throw new ApiException(message, status, false, response.path, response.contentType, response.bodyText, message);
    }
  }

  private parseBaseResponse(response: HttpResponseText): NativeApiBaseResponse {
    try {
      return JSON.parse(response.bodyText) as NativeApiBaseResponse;
    } catch (_) {
      const message = this.nonJsonMessage(response);
      throw new ApiException(message, response.statusCode, false, response.path, response.contentType, response.bodyText, message);
    }
  }

  private tryParseBaseResponse(text: string): NativeApiBaseResponse {
    try {
      return JSON.parse(text) as NativeApiBaseResponse;
    } catch (_) {
      const parsed: NativeApiBaseResponse = {};
      return parsed;
    }
  }

  private errorMessage(response: NativeApiBaseResponse, fallback: string): string {
    if (response.error && response.error.length > 0) return response.error;
    if (response.message && response.message.length > 0) return response.message;
    return fallback;
  }

  private nonJsonMessage(response: HttpResponseText): string {
    if (response.path === '/api/native/auth/login' && (response.statusCode === 404 || this.looksLikeHtml(response.bodyText))) {
      return '登录接口不存在或服务器地址错误，请检查 API 地址';
    }
    return '服务器返回非 JSON 数据，请检查 API 地址或接口路径';
  }

  private detectContentType(text: string): string {
    const trimmed = text.trim();
    if (trimmed.indexOf('<') === 0) return 'text/html';
    if (trimmed.indexOf('{') === 0 || trimmed.indexOf('[') === 0) return 'application/json';
    return '';
  }

  private looksLikeHtml(text: string): boolean {
    return text.trim().indexOf('<') === 0;
  }

  private method(method: string): http.RequestMethod {
    if (method === 'POST') return http.RequestMethod.POST;
    if (method === 'PATCH') return http.RequestMethod.PATCH;
    if (method === 'DELETE') return http.RequestMethod.DELETE;
    return http.RequestMethod.GET;
  }
}

export const httpClient = new NativeHttpClient();
