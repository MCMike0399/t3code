import { Context } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface KimiAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "kimi";
}

export class KimiAdapter extends Context.Service<KimiAdapter, KimiAdapterShape>()(
  "t3/provider/Services/KimiAdapter",
) {}
