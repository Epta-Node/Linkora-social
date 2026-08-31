import Ajv from "ajv";
import { InvalidManifestError } from "../errors.js";

const MAX_ENTRY_POINT_LENGTH = 2048;
const MAX_ICON_DATA_URL_LENGTH = 100000;

const manifestSchema = {
  type: "object",
  properties: {
    name: {
      type: "string",
      minLength: 1,
      maxLength: 50,
    },
    version: {
      type: "string",
      pattern: "^\\d+\\.\\d+\\.\\d+$",
    },
    description: {
      type: "string",
      maxLength: 200,
    },
    entryPoint: {
      type: "string",
      maxLength: MAX_ENTRY_POINT_LENGTH,
    },
    icon: {
      type: "string",
      maxLength: MAX_ICON_DATA_URL_LENGTH,
    },
    permissions: {
      type: "array",
      items: {
        type: "string",
        enum: ["wallet.read", "wallet.sign", "profile.read", "post.create"],
      },
      uniqueItems: true,
    },
  },
  required: ["name", "version", "entryPoint", "permissions"],
  additionalProperties: false,
};

const ajv = new Ajv();
const validate = ajv.compile(manifestSchema);

export interface MiniAppManifest {
  name: string;
  version: string;
  description?: string;
  entryPoint: string;
  icon?: string;
  permissions: ("wallet.read" | "wallet.sign" | "profile.read" | "post.create")[];
}

export function validateManifest(manifest: unknown): MiniAppManifest {
  const valid = validate(manifest);
  if (!valid) {
    const errorsText = ajv.errorsText(validate.errors);
    throw new InvalidManifestError(`Manifest validation failed: ${errorsText}`);
  }
  return manifest as unknown as MiniAppManifest;
}
