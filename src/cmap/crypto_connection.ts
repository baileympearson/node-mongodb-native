import type { Document } from 'bson';

import type { AutoEncrypter } from '../deps';
import { MongoCompatibilityError, MongoMissingDependencyError } from '../error';
import { type Callback, type MongoDBNamespace, maxWireVersion } from '../utils';
import type { Stream } from './connect';
import { CommandOptions, Connection, ConnectionOptions } from './connection';

/** @internal */
const kAutoEncrypter = Symbol('autoEncrypter');

/** @internal */
export class CryptoConnection extends Connection {
  /** @internal */
  [kAutoEncrypter]?: AutoEncrypter;

  constructor(stream: Stream, options: ConnectionOptions) {
    super(stream, options);
    this[kAutoEncrypter] = options.autoEncrypter;
  }

  /** @internal @override */
  override command(
    ns: MongoDBNamespace,
    cmd: Document,
    options: CommandOptions,
    callback: Callback
  ): void {
    const autoEncrypter = this[kAutoEncrypter];
    if (!autoEncrypter) {
      return callback(new MongoMissingDependencyError('No AutoEncrypter available for encryption'));
    }

    const serverWireVersion = maxWireVersion(this);
    if (serverWireVersion === 0) {
      // This means the initial handshake hasn't happened yet
      return super.command(ns, cmd, options, callback);
    }

    if (serverWireVersion < 8) {
      callback(
        new MongoCompatibilityError('Auto-encryption requires a minimum MongoDB version of 4.2')
      );
      return;
    }

    // Save sort or indexKeys based on the command being run
    // the encrypt API serializes our JS objects to BSON to pass to the native code layer
    // and then deserializes the encrypted result, the protocol level components
    // of the command (ex. sort) are then converted to JS objects potentially losing
    // import key order information. These fields are never encrypted so we can save the values
    // from before the encryption and replace them after encryption has been performed
    const sort: Map<string, number> | null = cmd.find || cmd.findAndModify ? cmd.sort : null;
    const indexKeys: Map<string, number>[] | null = cmd.createIndexes
      ? cmd.indexes.map((index: { key: Map<string, number> }) => index.key)
      : null;

    autoEncrypter.encrypt(ns.toString(), cmd, options, (err, encrypted) => {
      if (err || encrypted == null) {
        callback(err, null);
        return;
      }

      // Replace the saved values
      if (sort != null && (cmd.find || cmd.findAndModify)) {
        encrypted.sort = sort;
      }
      if (indexKeys != null && cmd.createIndexes) {
        for (const [offset, index] of indexKeys.entries()) {
          encrypted.indexes[offset].key = index;
        }
      }

      super.command(ns, encrypted, options, (err, response) => {
        if (err || response == null) {
          callback(err, response);
          return;
        }

        autoEncrypter.decrypt(response, options, callback);
      });
    });
  }
}
