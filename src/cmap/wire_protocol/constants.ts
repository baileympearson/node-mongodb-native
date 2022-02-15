/**
 * All known MongoDB Wire versions, used to determine basic feature support
 * - see the [server enum](https://github.com/mongodb/mongo/blob/fe4cf6134b16f102591053d6f4fe11e5cc0eb3ec/src/mongo/db/wire_version.h#L57)
 * - (note: the is a link to a commit so you can find the file, you should then check the main branch)
 */
export const MONGODB_WIRE_VERSION = Object.freeze({
  /** A helper wire version, 0 means no information about what is supported on the server is known */
  UNKNOWN: 0,
  /** Everything before we started tracking. */
  RELEASE_2_4_AND_BEFORE: 0,
  /** The aggregation command may now be requested to return cursors. */
  AGG_RETURNS_CURSORS: 1,
  /** insert, update, and delete batch command */
  BATCH_COMMANDS: 2,
  /** support SCRAM-SHA1, listIndexes, listCollections, new explain */
  RELEASE_2_7_7: 3,
  /** Support find and getMore commands, as well as OP_COMMAND in mongod (but not mongos). */
  FIND_COMMAND: 4,
  /** Supports all write commands take a write concern. */
  COMMANDS_ACCEPT_WRITE_CONCERN: 5,
  /** Supports the new OP_MSG wireprotocol (3.6+). */
  SUPPORTS_OP_MSG: 6,
  /** Supports replica set transactions (4.0+). */
  REPLICA_SET_TRANSACTIONS: 7,
  /** Supports sharded transactions (4.2+). */
  SHARDED_TRANSACTIONS: 8,
  /** Supports resumable initial sync (4.4+). */
  RESUMABLE_INITIAL_SYNC: 9,
  /** Supports features available from 4.7 and onwards. */
  WIRE_VERSION_47: 10,
  /** Supports features available from 4.8 and onwards. */
  WIRE_VERSION_48: 11,
  /**
   * Supports features available from 4.9 and onwards.
   * - EstimatedDocumentCountOperation can run as an aggregation
   */
  WIRE_VERSION_49: 12,
  /**
   * Supports features available from 5.0 and onwards.
   * - Writes to secondaries $out/$merge
   * - Snapshot reads
   */
  WIRE_VERSION_50: 13,
  /** Supports features available from 5.1 and onwards. */
  WIRE_VERSION_51: 14
} as const);

export const MIN_SUPPORTED_SERVER_VERSION = '3.6';
export const MAX_SUPPORTED_SERVER_VERSION = '5.1';
export const MIN_SUPPORTED_WIRE_VERSION = MONGODB_WIRE_VERSION.SUPPORTS_OP_MSG;
export const MAX_SUPPORTED_WIRE_VERSION = MONGODB_WIRE_VERSION.WIRE_VERSION_51;
export const OP_REPLY = 1;
export const OP_UPDATE = 2001;
export const OP_INSERT = 2002;
export const OP_QUERY = 2004;
export const OP_GETMORE = 2005;
export const OP_DELETE = 2006;
export const OP_KILL_CURSORS = 2007;
export const OP_COMPRESSED = 2012;
export const OP_MSG = 2013;
