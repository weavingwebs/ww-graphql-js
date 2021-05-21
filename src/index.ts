import { AxiosInstance } from 'axios';

type GraphQlErrorObj = {
  message: string;
  extensions?: {
    code: number;
  };
  path?: string[];
};

interface GraphQlResponse<T> {
  data: T;
  errors?: GraphQlErrorObj[];
}

const GraphQlErrorName = 'GraphQlError';

export class GraphQlError extends Error {
  public codes: number[] = [];
  public errors: GraphQlErrorObj[] = [];

  constructor(message?: string) {
    super(message);
    this.name = GraphQlErrorName;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = new Error(message).stack;
    }
  }

  public static fromResponse(data: GraphQlResponse<unknown>): GraphQlError {
    const err = new GraphQlError('unknown error');
    if (typeof data.errors !== 'undefined') {
      err.errors = data.errors;
      if (err.errors.length !== 0) {
        err.message = err.errors[0].message;
        err.errors.forEach((e) => {
          if (e.extensions && e.extensions.code) {
            err.codes.push(e.extensions.code);
          }
        });
      }
    }
    return err;
  }

  public static fromError(err: Error | GraphQlError): GraphQlError | null {
    if (err.name === GraphQlErrorName) {
      return err as GraphQlError;
    }
    return null;
  }

  public static hasErrorCode(err: Error | GraphQlError, code: number): boolean {
    const gqlErr = GraphQlError.fromError(err);
    if (!gqlErr) {
      return false;
    }
    return gqlErr.codes.includes(code);
  }
}

export const graphqlClient = (clientFactory: () => Promise<AxiosInstance>) => {
  return async <TQueryResponse, TQueryVariables = undefined>(
    query: string|string[],
    variables?: TQueryVariables,
  ): Promise<TQueryResponse> => {
    // Join multiple queries into one string.
    query = Array.isArray(query) ? query.join('\n') : query;

    // Check the variables for files.
    const map: {[key: string]: string[]} = {};
    const files: {[key: string]: File} = {};
    walkObject(variables, (v, path) => {
      if (v instanceof File) {
        const i = Object.keys(map).length;
        map[`${i}`] = [`variables.${path}`];
        files[`${i}`] = v;
        return false;
      }
      return true;
    });

    // If the variables contain files, we need to switch to doing a form post
    // instead.
    let body: string|FormData;
    let headers: {[key: string]: string} = {
      Accept: 'application/json',
    };
    if (Object.keys(map).length !== 0) {
      const form = new FormData();
      form.set('operations', JSON.stringify({
        query,
        variables,
      }));
      form.set('map', JSON.stringify(map));
      Object.keys(files).forEach(k => form.set(k, files[k]));

      body = form;
    } else {
      body = JSON.stringify({
        query,
        variables,
      });
      headers['Content-Type'] = 'application/json';
    }

    const httpClient = await clientFactory();
    return httpClient.post<GraphQlResponse<TQueryResponse>>(
      '',
      body,
      {
        headers,
      })
      .then(({ data }) => {
        if (typeof data.errors !== 'undefined') {
          throw GraphQlError.fromResponse(data);
        }
        if (typeof data.data === 'undefined') {
          throw new Error('no data returned');
        }
        return data.data;
      });
  };
}

// Callback should return false if the given value should be nulled.
type WalkObjectCallback = (v: any, path: string) => boolean;

function doWalkObject(obj: any, fn: WalkObjectCallback, path: string) {
  if (obj !== null) {
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => {
        if (doWalkObject(v, fn, makePath(path, i)) === false) {
          obj[i] = null;
        }
      })
      return;
    }

    if (typeof obj === 'object' && !(obj instanceof File)) {
      Object.keys(obj).forEach(k => {
        if (doWalkObject(obj[k], fn, makePath(path, k)) === false) {
          obj[k] = null;
        }
      })
      return;
    }
  }

  return fn(obj, path);
}

function walkObject(obj: any, fn: WalkObjectCallback) {
  doWalkObject(obj, fn, '');
}

const makePath = (path: string, key: string|number) => [path, key].filter(v => v !== '').join('.');
