import type { RequestOptions } from "node:http";

export function createPinnedLookup(
  address: string,
  family: 4 | 6,
): NonNullable<RequestOptions["lookup"]> {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}
