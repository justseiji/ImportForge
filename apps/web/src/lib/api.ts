import { QueryClient } from '@tanstack/react-query';
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      data.error?.code ?? 'UNKNOWN',
      data.error?.message ?? 'Request failed.',
    );
  return data;
}
export const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
      staleTime: 1000,
      refetchOnWindowFocus: true,
    },
  },
});
export const keys = {
  session: ['session'],
  imports: ['imports'],
  catalog: ['catalog'],
  suppliers: ['suppliers'],
  detail: (id: string) => ['import', id],
  rows: (id: string) => ['rows', id],
};
export async function refreshImport(id: string) {
  await Promise.all([
    client.invalidateQueries({ queryKey: keys.detail(id) }),
    client.invalidateQueries({ queryKey: keys.rows(id) }),
    client.invalidateQueries({ queryKey: keys.imports }),
    client.invalidateQueries({ queryKey: keys.catalog }),
  ]);
}
export function uploadFile(
  supplierId: string,
  file: File,
  progress: (n: number) => void,
): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/imports');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) progress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () =>
      reject(new Error('Connection interrupted. Check Imports before uploading again.'));
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) reject(new Error(data.error?.message ?? 'Upload failed.'));
        else resolve(data);
      } catch {
        reject(new Error('Unexpected upload response. Check Imports.'));
      }
    };
    const data = new FormData();
    data.append('supplierId', supplierId);
    data.append('file', file);
    xhr.send(data);
  });
}
