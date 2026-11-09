/**
 * TLS material for `custom-domains-https.test.ts` only: a CA made for these
 * tests (its private key was deleted right after signing, so it can sign
 * nothing else) and a certificate for `anna.test` it signed, valid until 2126.
 * Kept as a module, not `.pem` files: `*.pem` stays git-ignored for real keys.
 * Never trust this CA anywhere but in that test.
 */

export const TEST_CA = `-----BEGIN CERTIFICATE-----
MIIBszCCAVmgAwIBAgIUEuZriQaXgOrPpRay27azD80oNY8wCgYIKoZIzj0EAwIw
JjEkMCIGA1UEAwwbU3lub3JvIHRlc3QgQ0EgKHRlc3RzIG9ubHkpMCAXDTI2MTEw
OTExMzI1OFoYDzIxMjYxMDE2MTEzMjU4WjAmMSQwIgYDVQQDDBtTeW5vcm8gdGVz
dCBDQSAodGVzdHMgb25seSkwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARSO3gi
pQYuWZiAa9/PwAenpFql7PFXMkC81VboycbmE+UJNDmQ2R32x5/uCkVxZ1Yrfcva
/EA7KpPdjhC9g7NPo2MwYTAdBgNVHQ4EFgQUTOPalsAMMttlIY0ZdLMs6EdlXt0w
HwYDVR0jBBgwFoAUTOPalsAMMttlIY0ZdLMs6EdlXt0wDwYDVR0TAQH/BAUwAwEB
/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIgfZzG8xULx7fdpOlL
xjhJ2BJVPtY4iHJOnLp3nGA1EfQCIQCm218ZWlDVSo07qe+8d9T1BxfkO1esPPvD
0IHOPr08oQ==
-----END CERTIFICATE-----`;

export const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBxTCCAWugAwIBAgIUC37Otzr8PIycbLBY8hKncbRdrggwCgYIKoZIzj0EAwIw
JjEkMCIGA1UEAwwbU3lub3JvIHRlc3QgQ0EgKHRlc3RzIG9ubHkpMCAXDTI2MTEw
OTExMzI1OVoYDzIxMjYxMDE2MTEzMjU5WjAUMRIwEAYDVQQDDAlhbm5hLnRlc3Qw
WTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQ9mi/HybBvWf2C8SnusEdSzkQUVwi0
karN/nnIUf02gQcPNdCJrYNYyXOoyFD7NSIr6hknvLFneu1sjZOUtuUVo4GGMIGD
MBQGA1UdEQQNMAuCCWFubmEudGVzdDAJBgNVHRMEAjAAMAsGA1UdDwQEAwIHgDAT
BgNVHSUEDDAKBggrBgEFBQcDATAdBgNVHQ4EFgQUb+oMrG4vVhITJrzF3+Y4QSPB
mpwwHwYDVR0jBBgwFoAUTOPalsAMMttlIY0ZdLMs6EdlXt0wCgYIKoZIzj0EAwID
SAAwRQIhAIPmf/luiBY+3fAgWB2zkfvPI8Rd0qEG3I+65VxddYwcAiBrPw+ZSbLA
lNTAc3/PIf/1jXy/OD+Ds5qkxtriUrAYdg==
-----END CERTIFICATE-----`;

export const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgLlQ9Im8iWCv3ME/1
b7wKp1XpDNeCmhMOHGjOEsm2EdahRANCAAQ9mi/HybBvWf2C8SnusEdSzkQUVwi0
karN/nnIUf02gQcPNdCJrYNYyXOoyFD7NSIr6hknvLFneu1sjZOUtuUV
-----END PRIVATE KEY-----`;
