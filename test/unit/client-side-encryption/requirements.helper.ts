// Data Key Stuff
export const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
export const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
export const AWS_REGION = process.env.AWS_REGION;
export const AWS_CMK_ID = process.env.AWS_CMK_ID;

export const awsKmsProviders = {
  aws: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY }
};
export const awsDataKeyOptions = { masterKey: { key: AWS_CMK_ID, region: AWS_REGION } };

export const SKIP_AWS_TESTS = [
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_REGION,
  AWS_CMK_ID
].some(secret => !secret);

export function isAWSCredentialProviderInstalled() {
  try {
    require.resolve('@aws-sdk/credential-providers');
    return true;
  } catch {
    return false;
  }
}

export function isGCPCredentialProviderInstalled() {
  try {
    require.resolve('gcp-metadata');
    return true;
  } catch {
    return false;
  }
}

export const credentialProvidersInstalled = {
  aws: isAWSCredentialProviderInstalled(),
  gcp: isGCPCredentialProviderInstalled()
};
