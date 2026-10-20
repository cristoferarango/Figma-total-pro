/**
 * Dispatcher for the advanced tool surface. code.ts falls through to
 * handleAdvancedRequest() for request types it does not handle itself.
 */
import { ADVANCED_READ_REQUEST_TYPES, handleReadRequest } from "./advanced-read";
import { ADVANCED_WRITE_REQUEST_TYPES, handleWriteRequest } from "./advanced-write";
import { ADVANCED_DESIGN_REQUEST_TYPES, handleDesignRequest } from "./advanced-design";
import type { AdvancedRequest } from "./advanced-shared";

export type AdvancedReadRequestType = (typeof ADVANCED_READ_REQUEST_TYPES)[number];
export type AdvancedWriteRequestType = (typeof ADVANCED_WRITE_REQUEST_TYPES)[number];
export type AdvancedDesignRequestType = (typeof ADVANCED_DESIGN_REQUEST_TYPES)[number];

export type AdvancedRequestType =
  AdvancedReadRequestType | AdvancedWriteRequestType | AdvancedDesignRequestType;

/** Every advanced request that mutates the document (blocked in Dev Mode). */
export const ADVANCED_EDIT_REQUEST_TYPES: ReadonlyArray<AdvancedRequestType> = [
  ...ADVANCED_WRITE_REQUEST_TYPES,
  ...ADVANCED_DESIGN_REQUEST_TYPES,
];

export async function handleAdvancedRequest(
  request: AdvancedRequest
): Promise<unknown | undefined> {
  const read = await handleReadRequest(request);
  if (read !== undefined) return read;
  const write = await handleWriteRequest(request);
  if (write !== undefined) return write;
  return handleDesignRequest(request);
}
