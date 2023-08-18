import http from '../http';

const SECRETS_API_PATH = 'cms/v3/functions/secrets';

type FetchSecretsResponse = {
  results: Array<string>;
};

export async function addSecret(
  accountId: number,
  key: string,
  value: string
): Promise<void> {
  return http.post(accountId, {
    url: SECRETS_API_PATH,
    body: {
      key,
      secret: value,
    },
  });
}

export async function updateSecret(
  accountId: number,
  key: string,
  value: string
): Promise<void> {
  return http.put(accountId, {
    url: SECRETS_API_PATH,
    body: {
      key,
      secret: value,
    },
  });
}

export async function deleteSecret(
  accountId: number,
  key: string
): Promise<void> {
  return http.delete(accountId, {
    url: `${SECRETS_API_PATH}/${key}`,
  });
}

export async function fetchSecrets(
  accountId: number
): Promise<FetchSecretsResponse> {
  return http.get(accountId, {
    url: `${SECRETS_API_PATH}`,
  });
}
