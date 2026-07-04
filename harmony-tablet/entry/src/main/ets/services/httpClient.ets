import http from '@ohos.net.http';
import { API_BASE_URL, API_TIMEOUT_MS } from '../constants/api';
import type { PickedFile } from '../platform/FilePickerAdapter';

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
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

export interface MultipartUploadInput {
  fields: Record<string, string>;
  fileFieldName: string;
  file: PickedFile;
}

class NativeHttpClient {
  private token: string = '';

  setToken(token: string) {
    this.token = token;
  }

  clearToken() {
    this.token = '';
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body?: object): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async patch<T>(path: string, body?: object): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  async delete<T>(path: string, body?: object): Promise<T> {
    return this.request<T>('DELETE', path, body);
  }

  async uploadMultipart<T>(path: string, input: MultipartUploadInput): Promise<T> {
    if (!input.file.data) {
      throw new ApiException('文件读取能力需在 DevEco 真机环境补齐');
    }
    const boundary = `----hongmeng-native-${Date.now()}`;
    const payload = this.multipartPayload(boundary, input);
    return this.request<T>('POST', path, undefined, {
      contentType: `multipart/form-data; boundary=${boundary}`,
      extraData: payload
    });
  }

  contentUrl(path: string): string {
    return `${API_BASE_URL}${path}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: object,
    options: { contentType?: string; extraData?: string | ArrayBuffer } = {}
  ): Promise<T> {
    const client = http.createHttp();
    const headers: Record<string, string> = {
      'Accept': 'application/json'
    };
    if (options.contentType) {
      headers['Content-Type'] = options.contentType;
    } else if (body) {
      headers['Content-Type'] = 'application/json';
    }
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await client.request(`${API_BASE_URL}${path}`, {
        method: this.method(method),
        header: headers,
        extraData: options.extraData || (body ? JSON.stringify(body) : undefined),
        connectTimeout: API_TIMEOUT_MS,
        readTimeout: API_TIMEOUT_MS
      });
      const status = Number(response.responseCode || 0);
      const raw = typeof response.result === 'string' ? response.result : JSON.stringify(response.result || {});
      let parsed: ApiResult<T>;
      try {
        parsed = JSON.parse(raw) as ApiResult<T>;
      } catch (_) {
        throw new ApiException('服务返回格式异常', status);
      }
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
      return parsed.data as T;
    } catch (err) {
      if (err instanceof ApiException) {
        throw err;
      }
      throw new ApiException('网络连接失败，请检查平板网络');
    } finally {
      client.destroy();
    }
  }

  private method(method: string): http.RequestMethod {
    if (method === 'POST') return http.RequestMethod.POST;
    if (method === 'PATCH') return http.RequestMethod.PATCH;
    if (method === 'DELETE') return http.RequestMethod.DELETE;
    return http.RequestMethod.GET;
  }

  private multipartPayload(boundary: string, input: MultipartUploadInput): ArrayBuffer {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    Object.keys(input.fields).forEach(key => {
      chunks.push(encoder.encode(`--${boundary}\r\n`));
      chunks.push(encoder.encode(`Content-Disposition: form-data; name="${key}"\r\n\r\n`));
      chunks.push(encoder.encode(`${input.fields[key]}\r\n`));
    });
    chunks.push(encoder.encode(`--${boundary}\r\n`));
    chunks.push(encoder.encode(`Content-Disposition: form-data; name="${input.fileFieldName}"; filename="${input.file.name}"\r\n`));
    chunks.push(encoder.encode(`Content-Type: ${input.file.mimeType || 'application/octet-stream'}\r\n\r\n`));
    chunks.push(new Uint8Array(input.file.data as ArrayBuffer));
    chunks.push(encoder.encode(`\r\n--${boundary}--\r\n`));
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    chunks.forEach(chunk => {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    });
    return merged.buffer;
  }
}

export const httpClient = new NativeHttpClient();
