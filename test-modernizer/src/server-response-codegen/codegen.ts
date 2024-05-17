import assert from 'assert';
import { readFile } from 'fs/promises';
import * as joi from 'joi';
import { load } from 'js-yaml';
import * as ts from 'typescript';

import { log } from '../utils';

async function readYaml(filename: string): Promise<any> {
  const contents = await readFile(filename, 'utf-8');
  return load(contents);
}

export function readInputSchema(input: Record<string, unknown>) {
  const classes: ReturnType<typeof Model>[] = [];

  function Model(className: string, object: any) {
    const result: { type: string; required: boolean; lazy: boolean; name: string }[] = [];

    const fieldSchema = joi.object({
      type: joi.string().required(),
      required: joi.boolean().default(false),
      lazy: joi.boolean().default(false)
    });

    for (const [property, definition] of Object.entries(object)) {
      joi.assert(definition, fieldSchema);
      const { value: schema } = fieldSchema.validate(definition, { stripUnknown: true });

      result.push(
        Object.assign(Object.create(null), {
          ...schema,
          name: property
        })
      );
    }

    return {
      className,
      properties: result
    };
  }

  for (const [className, properties] of Object.entries(input)) {
    if (typeof properties !== 'object') throw new Error('definition must be an object');

    const model = Model(className, properties);
    classes.push(model);
  }

  return classes;
}

export async function readSpecification(filename: string) {
  return readInputSchema(await readYaml(filename));
}

function generateClassDefinition(
  model: ReturnType<typeof readInputSchema>[number]
): ts.ClassDeclaration {
  const { properties: modelProperties } = model;
  const properties: ts.ClassElement[] = [];

  const getterProperties = modelProperties.filter(property => property.lazy);
  const constructorProperties = modelProperties.filter(property => !property.lazy);

  function getType(type: string) {
    switch (type) {
      case 'int64':
        return 'BigInt';
      case 'array':
        return 'OnDemandArray';
    }
  }

  function makePropertyGetters() {
    return getterProperties.map(property => {
      assert(property.lazy);

      const typeNode = property.required
        ? ts.factory.createTypeReferenceNode(getType(property.type))
        : ts.factory.createUnionTypeNode([
            ts.factory.createTypeReferenceNode(getType(property.type)),
            ts.factory.createLiteralTypeNode(ts.factory.createNull())
          ]);

      return ts.factory.createGetAccessorDeclaration(
        [],
        property.name,
        [],
        typeNode,
        ts.factory.createBlock([ts.factory.createReturnStatement(makeOnDemandBSONAccess(property))])
      );
    });
  }

  // given a bson type, return the appropropriate BSON type access (i.e., int64 -> BSONType.long)
  function makeBSONType(type: string): ts.Expression {
    const _type = (() => {
      switch (type) {
        case 'int64':
          return 'long';
        case 'string':
          return 'string';
        case 'array':
          return 'array';
        default:
          throw new Error('unsupported type.');
      }
    })();
    return ts.factory.createPropertyAccessExpression(
      ts.factory.createIdentifier('BSONType'),
      _type
    );
  }

  function makeOnDemandBSONAccess(property: (typeof model)['properties'][number]): ts.Expression {
    const required = property.required ? ts.factory.createTrue() : ts.factory.createFalse();
    return ts.factory.createCallExpression(
      ts.factory.createPropertyAccessExpression(
        ts.factory.createPropertyAccessExpression(ts.factory.createThis(), 'response'),
        'get'
      ),
      [] /** type arguments */,
      [ts.factory.createStringLiteral(property.name), makeBSONType(property.type), required]
    );
  }

  function makeConstructor(): ts.ConstructorDeclaration {
    const constructorAssignedProperties = constructorProperties.map(property => {
      return ts.factory.createExpressionStatement(
        ts.factory.createAssignment(
          ts.factory.createPropertyAccessChain(
            ts.factory.createIdentifier('this'),
            undefined,
            property.name
          ),
          makeOnDemandBSONAccess(property)
        )
      );
    });

    return ts.factory.createConstructorDeclaration(
      [] /** modifiers */,
      [
        ts.factory.createParameterDeclaration(
          [
            ts.factory.createModifier(ts.SyntaxKind.PublicKeyword),
            ts.factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)
          ],
          undefined,
          'response',
          undefined,
          ts.factory.createTypeReferenceNode('MongoDBResponse')
        )
      ],
      ts.factory.createBlock([...constructorAssignedProperties]) /** body */
    );
  }

  function makeConstructedFieldPropertyDeclarations() {
    return constructorProperties.map(property => {
      const typeNode = property.required
        ? ts.factory.createTypeReferenceNode(getType(property.type))
        : ts.factory.createUnionTypeNode([
            ts.factory.createTypeReferenceNode(getType(property.type)),
            ts.factory.createLiteralTypeNode(ts.factory.createNull())
          ]);

      const initializer = property.required ? undefined : ts.factory.createNull();

      return ts.factory.createPropertyDeclaration(
        [ts.factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)],
        property.name,
        undefined,
        typeNode,
        initializer
      );
    });
  }

  properties.push(
    ...makePropertyGetters(),
    ...makeConstructedFieldPropertyDeclarations(),
    makeConstructor()
  );

  return ts.factory.createClassDeclaration(
    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    model.className,
    [] /** type parameters  */,
    [] /** heritige clauses */,
    properties
  );
}

export function generateModelClasses(schema: ReturnType<typeof readInputSchema>): ts.SourceFile {
  const statements: ts.Statement[] = [];

  for (const model of schema) {
    statements.push(generateClassDefinition(model));
  }

  const sourceFile = ts.factory.createSourceFile(
    statements,
    ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
    ts.NodeFlags.None
  );

  return sourceFile;
}

// function onDemandBSONGet(name: string, bsonType: string, required: boolean) {
//   const _bsonType = getBSONType(bsonType);
//   const _required = required ? ts.factory.createTrue() : ts.factory.createFalse();
//   const call = ts.factory.createCallExpression(
//     ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('response'), 'get'),
//     undefined,
//     [ts.factory.createStringLiteral(name), _bsonType, _required]
//   );

//   const assignment = ts.factory.createAssignment(
//     ts.factory.createPropertyAccessExpression(ts.factory.createThis(), name),
//     call
//   );

//   return assignment;
// }

// class ClassDefinitionBuilder {
//   exported?: boolean;
//   private members: ts.ClassElement[] = [];
//   private constructorInitilizers: ts.Statement[] = [];

//   constructor(private name: string) {
//     this.name = name;
//   }

//   addMember(member: ts.ClassElement) {
//     this.members.push(member);
//   }

//   addInit(init: ts.Statement) {
//     this.constructorInitilizers.push(init);
//   }

//   build() {
//     const exported = this.exported ? [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)] : [];
//     const constructor_ = ts.factory.createConstructorDeclaration(
//       undefined,
//       [
//         ts.factory.createParameterDeclaration(
//           undefined,
//           undefined,
//           'response',
//           undefined,
//           ts.factory.createTypeReferenceNode('MongoDBResponse'),
//           undefined /** initializer */
//         )
//       ],
//       ts.factory.createBlock(this.constructorInitilizers, true /** multiline */)
//     );
//     return ts.factory.createClassDeclaration(exported, this.name, undefined, undefined, [
//       ...this.members,
//       constructor_
//     ]);
//   }
// }

// async function main(sourceFile: string, destination: string) {
//   const contents = await readYaml(sourceFile);

//   const classDef = {
//     name: 'Cursor',
//     fields: {
//       id: {
//         type: 'int64',
//         required: true
//       },
//       namespace: {
//         type: 'string',
//         required: false
//       },
//       firstBatch: {
//         type: 'array',
//         required: false
//       },
//       nextBatch: {
//         type: 'array',
//         required: false
//       }
//     }
//   };

//   const { name, fields } = classDef;
//   const builder = new ClassDefinitionBuilder(name);
//   builder.exported = true;
//   for (const [field, definition] of Object.entries(fields)) {
//     const node = ts.factory.createPropertyDeclaration(
//       /** modifiers */ undefined,
//       field,
//       /** required? */ undefined,
//       ts.factory.createKeywordTypeNode(ts.SyntaxKind.BigIntKeyword),
//       undefined
//     );

//     const _initStatement = onDemandBSONGet(field, definition.type, definition.required);

//     builder.addMember(node);
//     builder.addInit(ts.factory.createExpressionStatement(_initStatement));
//   }

//   const _class = builder.build();

//   //   await write(_class, destination);
//   //   log(await write(onDemandBSONGet('id', 'int64', true), 'out.txt'));
//   //   log(await write(_class, 'methods.txt'));
//   console.log(await formatSource(_class));
// }

`
function _throw(e: Error): never {
  throw e;
}

class Cursor {
  id: bigint;
  namespace: string | null;
  batch: OnDemandDocument;
  constructor(response: OnDemandDocument) {
    this.id = response.get('id', BSONType.long, true);
    this.namespace = response.get('namespace', BSONType.string);
    this.batch =
      response.get('firstBatch', BSONType.array) ??
      response.get('nextBatch', BSONType.array) ??
      _throw(new Error('ahhh'));
  }
}

export class CursorResponse2<T> implements ICursorIterable<T> {
  private cursor: Cursor;
  batchSize: number;
  private iterated = 0;

  get ns() {
    return this.cursor.namespace ? ns(this.cursor.namespace) : null;
  }

  constructor(response: MongoDBResponse) {
    this.cursor = new Cursor(response.get('cursor', BSONType.object, true));
    this.batchSize = this.cursor.batch.size();
  }

  shift(options?: BSONSerializeOptions): any {
    if (this.iterated >= this.batchSize) {
      return null;
    }

    const result = this.cursor.batch.get(this.iterated, BSONType.object, true) ?? null;
    this.iterated += 1;

    if (options?.raw) {
      return result.toBytes();
    } else {
      return result.toObject(options);
    }
  }

  get length() {
    return Math.max(this.batchSize - this.iterated, 0);
  }

  clear() {
    this.iterated = this.batchSize;
  }

  pushMany() {
    throw new Error('pushMany Unsupported method');
  }

  push() {
    throw new Error('push Unsupported method');
  }
}


class Hello {
  isWriteablePrimary: boolean;
  connectionId: bigint;
  reply: Document;
  hosts: OnDemandArray | null;
  passives: OnDemandArray | null;
  arbiters: OnDemandArray | null;
  tags: OnDemandDocument | null;

  minWireVersion: number;
  maxWireVersion: number;

  lastWrite: number | null;

  topologyVersion: unknown;

  setName: string | null;
  setVersion: OnDemandDocument | null;
  electionId: ObjectId | null;
  logicalSessionTimeoutMinutes: number | null;
  primary: string | null;
  me: string | null;

  $clusterTime: ClusterTime | null;

  constructor(response: MongoDBResponse) {
    this.isWriteablePrimary = response.get('isWriteablePrimary', BSONType.bool, true);
    this.connectionId = response.get('connectionId', BSONType.long, true);
    this.reply = response.get('reply', BSONType.object, true);
    this.hosts = response.get('hosts', BSONType.array);
    this.passives = response.get('passives', BSONType.array);
    this.arbiters = response.get('arbiters', BSONType.array);

    // TODO - figure out how to make this have optional defaults
    this.tags = response.get('tags', BSONType.object);
    this.minWireVersion = response.getNumber('minWireVersion', true);
    this.maxWireVersion = response.getNumber('maxWireVersion', true);

    this.lastWrite = response.get('lastWrite', BSONType.object)?.getNumber('lastWriteDate') ?? null;
    this.setName = response.get('setName', BSONType.string);
    this.setVersion = response.get('setVersion', BSONType.object);
    this.electionId = response.get('electionId', BSONType.objectId);

    this.logicalSessionTimeoutMinutes = response.getNumber('logicalSessionTimeoutMinutes');
    this.primary = response.get('primary', BSONType.string);
    this.me = response.get('me', BSONType.string);

    this.$clusterTime = response.$clusterTime;
  }
}

`;
