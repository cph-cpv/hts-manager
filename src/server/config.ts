import { z } from 'zod'

function emptyStringToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

const optionalString = z.preprocess(
  emptyStringToUndefined,
  z.string().min(1).optional(),
)

function booleanFromEnv(defaultValue: boolean) {
  return z.preprocess(
    emptyStringToUndefined,
    z
      .stringbool({ truthy: ['true'], falsy: ['false'] })
      .default(defaultValue),
  )
}

const optionalNonnegativeInteger = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().int().nonnegative().optional(),
)

const environmentSchema = z.object({
  HTSM_PIN: optionalString,
  HTSM_SESSION_SECRET: optionalString,
  HTSM_SECURE: booleanFromEnv(true),
  HTSM_DB_PATH: z.preprocess(
    emptyStringToUndefined,
    z.string().min(1).default('./hts-manager.db'),
  ),
  HTSM_SCAN_PATH: optionalString,
  HTSM_TRANSFER_SOURCE_PATH: optionalString,
  HTSM_TRANSFER_REMOVE_AFTER_DAYS: optionalNonnegativeInteger,
  VT_UPLOAD_URL: z.preprocess(
    emptyStringToUndefined,
    z.url().default('https://preview.virtool.ca/api/uploads'),
  ),
  VT_UPLOAD_FILE_TYPE: z.preprocess(
    emptyStringToUndefined,
    z.string().min(1).default('reads'),
  ),
  VT_UPLOAD_USER_HANDLE: optionalString,
  VT_UPLOAD_API_KEY: optionalString,
})

export type Config = {
  auth: {
    pin: string | undefined
    sessionSecret: string | undefined
    secure: boolean
  }
  dbPath: string
  scanPath: string | undefined
  transfer: {
    sourcePath: string | undefined
    removeAfterDays: number | undefined
  }
  upload: {
    url: string
    type: string
    userHandle: string | undefined
    apiKey: string | undefined
  }
}

/** Parse raw environment strings into the application's typed configuration. */
export function readConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = environmentSchema.parse(env)
  return {
    auth: {
      pin: parsed.HTSM_PIN,
      sessionSecret: parsed.HTSM_SESSION_SECRET,
      secure: parsed.HTSM_SECURE,
    },
    dbPath: parsed.HTSM_DB_PATH,
    scanPath: parsed.HTSM_SCAN_PATH,
    transfer: {
      sourcePath: parsed.HTSM_TRANSFER_SOURCE_PATH,
      removeAfterDays: parsed.HTSM_TRANSFER_REMOVE_AFTER_DAYS,
    },
    upload: {
      url: parsed.VT_UPLOAD_URL,
      type: parsed.VT_UPLOAD_FILE_TYPE,
      userHandle: parsed.VT_UPLOAD_USER_HANDLE,
      apiKey: parsed.VT_UPLOAD_API_KEY,
    },
  }
}

let config: Config | undefined

/** Return the process configuration, parsing it once on first use. */
export function getConfig(): Config {
  config ??= readConfig(process.env)
  return config
}

export function getAuthConfig(): {
  pin: string
  sessionSecret: string
  secure: boolean
} {
  const { pin, sessionSecret, secure } = getConfig().auth
  if (!pin) throw new Error('HTSM_PIN is not set')
  if (!sessionSecret) throw new Error('HTSM_SESSION_SECRET is not set')
  return { pin, sessionSecret, secure }
}

export function getUploadConfig(): {
  url: string
  type: string
  userHandle: string
  apiKey: string
} {
  const { url, type, userHandle, apiKey } = getConfig().upload
  if (!userHandle || !apiKey) {
    throw new Error(
      'VT_UPLOAD_USER_HANDLE and VT_UPLOAD_API_KEY must be set to upload',
    )
  }
  return { url, type, userHandle, apiKey }
}
