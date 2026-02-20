/**
 * Schema-driven type system for SharedObjects.
 *
 * A schema is a plain object mapping field names to types. Each field is either
 * a scalar (Type.Float32) or a fixed-length array ([Type.Float32, 3]).
 *
 * From a schema definition, this module derives:
 *   - A memory layout (byte offsets and total size), computed once at creation
 *   - TypeScript types for reading (SchemaValues) and writing (SchemaWriteValues)
 *   - Functions to read/write fields directly via DataView, with no serialization
 */

export enum Type {
  Int8 = 1,
  Uint8 = 2,
  Int16 = 3,
  Uint16 = 4,
  Int32 = 5,
  Uint32 = 6,
  Float32 = 7,
  Float64 = 8,
}

const TYPE_SIZE: Record<Type, number> = {
  [Type.Int8]: 1,
  [Type.Uint8]: 1,
  [Type.Int16]: 2,
  [Type.Uint16]: 2,
  [Type.Int32]: 4,
  [Type.Uint32]: 4,
  [Type.Float32]: 4,
  [Type.Float64]: 8,
};

const TYPE_GETTER: Record<Type, keyof DataView> = {
  [Type.Int8]: "getInt8",
  [Type.Uint8]: "getUint8",
  [Type.Int16]: "getInt16",
  [Type.Uint16]: "getUint16",
  [Type.Int32]: "getInt32",
  [Type.Uint32]: "getUint32",
  [Type.Float32]: "getFloat32",
  [Type.Float64]: "getFloat64",
};

const TYPE_SETTER: Record<Type, keyof DataView> = {
  [Type.Int8]: "setInt8",
  [Type.Uint8]: "setUint8",
  [Type.Int16]: "setInt16",
  [Type.Uint16]: "setUint16",
  [Type.Int32]: "setInt32",
  [Type.Uint32]: "setUint32",
  [Type.Float32]: "setFloat32",
  [Type.Float64]: "setFloat64",
};

/**
 * Maps each Type enum value to its corresponding TypedArray class.
 * Used as an indexed lookup by TypedArrayFor<T> to resolve types at compile time.
 */
interface TypedArrayMap {
  [Type.Int8]: Int8Array;
  [Type.Uint8]: Uint8Array;
  [Type.Int16]: Int16Array;
  [Type.Uint16]: Uint16Array;
  [Type.Int32]: Int32Array;
  [Type.Uint32]: Uint32Array;
  [Type.Float32]: Float32Array;
  [Type.Float64]: Float64Array;
}

/**
 * Resolves a Type enum value to its TypedArray type via indexed access into 
 * TypedArrayMap.  e.g. TypedArrayFor<Type.Float32> = Float32Array
 */
type TypedArrayFor<T extends Type> = TypedArrayMap[T];

type TypedArrayConstructorFor<T extends Type> = {
  new(buffer: ArrayBufferLike, byteOffset: number, length: number): TypedArrayFor<T>;
};

const TYPE_ARRAY_CTOR: Record<Type, TypedArrayConstructorFor<Type>> = {
  [Type.Int8]: Int8Array as TypedArrayConstructorFor<Type>,
  [Type.Uint8]: Uint8Array as TypedArrayConstructorFor<Type>,
  [Type.Int16]: Int16Array as TypedArrayConstructorFor<Type>,
  [Type.Uint16]: Uint16Array as TypedArrayConstructorFor<Type>,
  [Type.Int32]: Int32Array as TypedArrayConstructorFor<Type>,
  [Type.Uint32]: Uint32Array as TypedArrayConstructorFor<Type>,
  [Type.Float32]: Float32Array as TypedArrayConstructorFor<Type>,
  [Type.Float64]: Float64Array as TypedArrayConstructorFor<Type>,
};

/**
 * A schema definition is a plain object mapping field names to field types.
 * Must be declared `as const` to preserve literal types for type inference.
 * Uses an interface to allow recursive (nested) schemas without circular alias errors.
 * e.g. { health: Type.Int32, position: [Type.Float32, 3], transform: { x: Type.Float32 } }
 */
export interface SchemaDefinition {
  readonly [key: string]: Type | readonly [Type, number] | SchemaDefinition;
}

/**
 * Derives the JS read types from a schema. Scalar fields become `number`,
 * array fields become the corresponding TypedArray (e.g. Float32Array),
 * and nested schema fields become a nested SchemaValues object.
 */
export type SchemaValues<S extends SchemaDefinition> = {
  [K in keyof S]: S[K] extends readonly [infer T extends Type, number]
  ? TypedArrayFor<T>
  : S[K] extends SchemaDefinition
  ? SchemaValues<S[K]>
  : number;
};

/**
 * Derives the JS write types from a schema. Same as SchemaValues, except
 * array fields also accept ArrayLike<number> for ergonomics (e.g. plain [1, 2, 3]),
 * and nested schema fields accept partial values at every level.
 */
export type SchemaWriteValues<S extends SchemaDefinition> = {
  [K in keyof S]: S[K] extends readonly [infer T extends Type, number]
  ? TypedArrayFor<T> | ArrayLike<number>
  : S[K] extends SchemaDefinition
  ? Partial<SchemaWriteValues<S[K]>>
  : number;
};

interface ScalarFieldLayout {
  kind: "scalar";
  type: Type;
  offset: number;
}

interface ArrayFieldLayout {
  kind: "array";
  type: Type;
  offset: number;
  count: number;
}

interface NestedFieldLayout {
  kind: "nested";
  offset: number;
  layout: Layout<SchemaDefinition>;
}

type FieldLayout = ScalarFieldLayout | ArrayFieldLayout | NestedFieldLayout;

export interface Layout<S extends SchemaDefinition> {
  fields: { [K in keyof S]: FieldLayout };
  byteLength: number;
}

function isNestedSchema(raw: SchemaDefinition[string]): raw is SchemaDefinition {
  return typeof raw === "object" && !Array.isArray(raw);
}

/**
 * Returns the maximum element alignment required by any field in a schema.
 */
function maxAlignment(schema: SchemaDefinition): number {
  let align = 1;
  for (const raw of Object.values(schema)) {
    if (isNestedSchema(raw)) {
      align = Math.max(align, maxAlignment(raw));
    } else {
      const type = typeof raw === "number" ? raw : raw[0];
      align = Math.max(align, TYPE_SIZE[type]);
    }
  }
  return align;
}

/**
 * Walks a schema and computes the byte offset of each field, respecting natural
 * alignment (each field aligned to its element size). Recurses into nested schemas.
 * Called once at creation time.
 */
export function computeLayout<S extends SchemaDefinition>(schema: S): Layout<S> {
  let offset = 0;
  const fields = {} as { [K in keyof S]: FieldLayout };

  for (const key of Object.keys(schema) as (keyof S & string)[]) {
    const raw = schema[key];

    if (isNestedSchema(raw)) {
      const nested = computeLayout(raw);
      const align = maxAlignment(raw);
      offset = Math.ceil(offset / align) * align;
      fields[key] = { kind: "nested", offset, layout: nested };
      offset += nested.byteLength;
    } else {
      const type = typeof raw === "number" ? raw : raw[0];
      const count = typeof raw === "number" ? 1 : raw[1];
      const elemSize = TYPE_SIZE[type];
      offset = Math.ceil(offset / elemSize) * elemSize;
      if (count === 1) {
        fields[key] = { kind: "scalar", type, offset };
      } else {
        fields[key] = { kind: "array", type, offset, count };
      }
      offset += elemSize * count;
    }
  }

  return { fields, byteLength: offset };
}

/**
 * Reads all fields from a DataView into a plain object according to the layout.
 * Scalar fields use a single DataView getter call. Array fields return a TypedArray
 * view directly into the underlying buffer (no copy). Nested fields recurse.
 */
export function readSnapshot<S extends SchemaDefinition>(
  layout: Layout<S>,
  dataView: DataView,
  baseOffset = 0,
): SchemaValues<S> {
  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(layout.fields) as (keyof S & string)[]) {
    const field = layout.fields[key];
    const abs = baseOffset + field.offset;
    switch (field.kind) {
      case "scalar": {
        const getter = TYPE_GETTER[field.type] as keyof DataView;
        out[key] = (dataView[getter] as Function).call(dataView, abs, true);
        break;
      }
      case "array": {
        const Ctor = TYPE_ARRAY_CTOR[field.type];
        out[key] = new Ctor(dataView.buffer, dataView.byteOffset + abs, field.count);
        break;
      }
      case "nested": {
        out[key] = readSnapshot(field.layout, dataView, abs);
        break;
      }
    }
  }
  return out as SchemaValues<S>;
}

/**
 * Writes a partial set of fields into a DataView according to the layout.
 * Scalar fields use a single DataView setter call. Array fields iterate
 * and write each element individually. Nested fields recurse.
 */
export function writeFields<S extends SchemaDefinition>(
  layout: Layout<S>,
  dataView: DataView,
  values: Partial<SchemaWriteValues<S>>,
  baseOffset = 0,
): void {
  for (const key of Object.keys(values) as (keyof S & string)[]) {
    const field = layout.fields[key];
    const val = values[key];
    const abs = baseOffset + field.offset;
    switch (field.kind) {
      case "scalar": {
        const setter = TYPE_SETTER[field.type] as keyof DataView;
        (dataView[setter] as Function).call(dataView, abs, val, true);
        break;
      }
      case "array": {
        const src = val as ArrayLike<number>;
        const setter = TYPE_SETTER[field.type] as keyof DataView;
        const elemSize = TYPE_SIZE[field.type];
        for (let i = 0; i < field.count; i++) {
          (dataView[setter] as Function).call(
            dataView,
            abs + i * elemSize,
            src[i],
            true,
          );
        }
        break;
      }
      case "nested": {
        writeFields(
          field.layout,
          dataView,
          val as Partial<SchemaWriteValues<SchemaDefinition>>,
          abs,
        );
        break;
      }
    }
  }
}
