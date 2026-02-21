/**
 * Schema-driven type system for SharedObjects.
 *
 * A schema is a plain object mapping field names to types. Each field is either
 * a scalar numeric value (Type.Float32), a fixed-length numeric array
 * ([Type.Float32, 3]), a fixed-length RGBA8 pixel buffer ([Type.Rgba8, pixels]),
 * or a fixed-length UTF-8 string ([Type.Utf8, 64]).
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
  Utf8 = 9,
  Rgba8 = 10,
}

type ScalarType = Exclude<Type, Type.Utf8 | Type.Rgba8>;
type ArrayType = ScalarType | Type.Rgba8;

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

const SCALAR_TYPE_SIZE: Record<ScalarType, number> = {
  [Type.Int8]: 1,
  [Type.Uint8]: 1,
  [Type.Int16]: 2,
  [Type.Uint16]: 2,
  [Type.Int32]: 4,
  [Type.Uint32]: 4,
  [Type.Float32]: 4,
  [Type.Float64]: 8,
};

const ARRAY_ELEMENT_SIZE: Record<ArrayType, number> = {
  [Type.Int8]: 1,
  [Type.Uint8]: 1,
  [Type.Int16]: 2,
  [Type.Uint16]: 2,
  [Type.Int32]: 4,
  [Type.Uint32]: 4,
  [Type.Float32]: 4,
  [Type.Float64]: 8,
  [Type.Rgba8]: 4,
};

const ARRAY_VIEW_LENGTH_MULTIPLIER: Record<ArrayType, number> = {
  [Type.Int8]: 1,
  [Type.Uint8]: 1,
  [Type.Int16]: 1,
  [Type.Uint16]: 1,
  [Type.Int32]: 1,
  [Type.Uint32]: 1,
  [Type.Float32]: 1,
  [Type.Float64]: 1,
  [Type.Rgba8]: 4,
};

const TYPE_GETTER: Record<ScalarType, keyof DataView> = {
  [Type.Int8]: "getInt8",
  [Type.Uint8]: "getUint8",
  [Type.Int16]: "getInt16",
  [Type.Uint16]: "getUint16",
  [Type.Int32]: "getInt32",
  [Type.Uint32]: "getUint32",
  [Type.Float32]: "getFloat32",
  [Type.Float64]: "getFloat64",
};

const TYPE_SETTER: Record<ScalarType, keyof DataView> = {
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
  [Type.Rgba8]: Uint8Array;
}

/**
 * Resolves an array element Type to its TypedArray type via indexed access into
 * TypedArrayMap.  e.g. TypedArrayFor<Type.Float32> = Float32Array
 */
type TypedArrayFor<T extends ArrayType> = TypedArrayMap[T];

type TypedArrayConstructorFor<T extends ArrayType> = {
  new(buffer: ArrayBufferLike, byteOffset: number, length: number): TypedArrayFor<T>;
};

const TYPE_ARRAY_CTOR: Record<ArrayType, TypedArrayConstructorFor<ArrayType>> = {
  [Type.Int8]: Int8Array as TypedArrayConstructorFor<ArrayType>,
  [Type.Uint8]: Uint8Array as TypedArrayConstructorFor<ArrayType>,
  [Type.Int16]: Int16Array as TypedArrayConstructorFor<ArrayType>,
  [Type.Uint16]: Uint16Array as TypedArrayConstructorFor<ArrayType>,
  [Type.Int32]: Int32Array as TypedArrayConstructorFor<ArrayType>,
  [Type.Uint32]: Uint32Array as TypedArrayConstructorFor<ArrayType>,
  [Type.Float32]: Float32Array as TypedArrayConstructorFor<ArrayType>,
  [Type.Float64]: Float64Array as TypedArrayConstructorFor<ArrayType>,
  [Type.Rgba8]: Uint8Array as TypedArrayConstructorFor<ArrayType>,
};

/**
 * A schema definition is a plain object mapping field names to field types.
 * Must be declared `as const` to preserve literal types for type inference.
 * Uses an interface to allow recursive (nested) schemas without circular alias errors.
 * e.g. {
 *   health: Type.Int32,
 *   position: [Type.Float32, 3],
 *   title: [Type.Utf8, 64],
 *   feed: [Type.Rgba8, 320 * 180]
 * }
 */
export interface SchemaDefinition {
  readonly [key: string]: ScalarType | readonly [Type, number] | SchemaDefinition;
}

/**
 * Derives the JS read types from a schema. Scalar fields become `number`,
 * array fields become the corresponding TypedArray (e.g. Float32Array),
 * and nested schema fields become a nested SchemaValues object.
 */
export type SchemaValues<S extends SchemaDefinition> = {
  [K in keyof S]: S[K] extends readonly [Type.Utf8, number]
  ? string
  : S[K] extends readonly [infer T extends ArrayType, number]
  ? TypedArrayFor<T>
  : S[K] extends SchemaDefinition
  ? SchemaValues<S[K]>
  : number;
};

/**
 * Derives the JS write types from a schema. Array fields require concrete
 * typed arrays to ensure writes can use one bulk copy operation.
 * Nested schema fields accept partial values at every level.
 */
export type SchemaWriteValues<S extends SchemaDefinition> = {
  [K in keyof S]: S[K] extends readonly [Type.Utf8, number]
  ? string
  : S[K] extends readonly [infer T extends ArrayType, number]
  ? TypedArrayFor<T>
  : S[K] extends SchemaDefinition
  ? Partial<SchemaWriteValues<S[K]>>
  : number;
};

interface ScalarFieldLayout {
  kind: "scalar";
  type: ScalarType;
  offset: number;
}

interface ArrayFieldLayout {
  kind: "array";
  type: ArrayType;
  offset: number;
  count: number;
}

interface Utf8FieldLayout {
  kind: "utf8";
  offset: number;
  byteLength: number;
}

interface NestedFieldLayout {
  kind: "nested";
  offset: number;
  layout: Layout<SchemaDefinition>;
}

type FieldLayout = ScalarFieldLayout | ArrayFieldLayout | Utf8FieldLayout | NestedFieldLayout;

export interface Layout<S extends SchemaDefinition> {
  fields: { [K in keyof S]: FieldLayout };
  byteLength: number;
}

function isNestedSchema(raw: SchemaDefinition[string]): raw is SchemaDefinition {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function isScalarType(type: number): type is ScalarType {
  switch (type) {
    case Type.Int8:
    case Type.Uint8:
    case Type.Int16:
    case Type.Uint16:
    case Type.Int32:
    case Type.Uint32:
    case Type.Float32:
    case Type.Float64:
      return true;
    default:
      return false;
  }
}

function isArrayType(type: Type): type is ArrayType {
  return isScalarType(type) || type === Type.Rgba8;
}

function typeName(type: number): string {
  return Type[type as Type] ?? String(type);
}

function valueName(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (ArrayBuffer.isView(value)) return value.constructor.name;
  if (typeof value === "object" && "constructor" in (value as object)) {
    const name = (value as { constructor?: { name?: string } }).constructor?.name;
    if (name) return name;
  }
  return typeof value;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer, got ${value}`);
  }
}

/**
 * Returns the maximum element alignment required by any field in a schema.
 */
function maxAlignment(schema: SchemaDefinition): number {
  let align = 1;
  for (const raw of Object.values(schema)) {
    if (isNestedSchema(raw)) align = Math.max(align, maxAlignment(raw));
    else {
      if (typeof raw === "number") {
        if (!isScalarType(raw)) {
          throw new Error(`Invalid scalar type ${typeName(raw)} in schema`);
        }
        align = Math.max(align, SCALAR_TYPE_SIZE[raw]);
      }
      else {
        const type = raw[0];
        if (type === Type.Utf8) continue;
        if (!isArrayType(type)) {
          throw new Error(`Invalid array type ${typeName(type)} in schema`);
        }
        align = Math.max(align, ARRAY_ELEMENT_SIZE[type]);
      }
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
      if (typeof raw === "number") {
        if (!isScalarType(raw)) {
          throw new Error(`Field "${key}" uses non-scalar type ${typeName(raw)} as scalar`);
        }
        const elemSize = SCALAR_TYPE_SIZE[raw];
        offset = Math.ceil(offset / elemSize) * elemSize;
        fields[key] = { kind: "scalar", type: raw, offset };
        offset += elemSize;
      } else {
        const type = raw[0];
        const count = raw[1];
        assertPositiveInteger(count, `Field "${key}" length`);
        if (type === Type.Utf8) {
          fields[key] = { kind: "utf8", offset, byteLength: count };
          offset += count;
          continue;
        }
        if (!isArrayType(type)) {
          throw new Error(`Field "${key}" uses unsupported array type ${typeName(type)}`);
        }

        const elemSize = ARRAY_ELEMENT_SIZE[type];
        offset = Math.ceil(offset / elemSize) * elemSize;
        fields[key] = { kind: "array", type, offset, count };
        offset += elemSize * count;
      }
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
        const length = field.count * ARRAY_VIEW_LENGTH_MULTIPLIER[field.type];
        out[key] = new Ctor(dataView.buffer, dataView.byteOffset + abs, length);
        break;
      }
      case "utf8": {
        const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset + abs, field.byteLength);
        const zeroIndex = bytes.indexOf(0);
        const end = zeroIndex >= 0 ? zeroIndex : bytes.length;
        out[key] = UTF8_DECODER.decode(bytes.subarray(0, end));
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
 * Scalar fields use a single DataView setter call. Array fields use one
 * typed-array bulk copy. Nested fields recurse.
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
    if (val === undefined) continue;
    const abs = baseOffset + field.offset;
    switch (field.kind) {
      case "scalar": {
        if (typeof val !== "number") {
          throw new Error(`Expected a number for scalar field "${key}", got ${typeof val}`);
        }
        const setter = TYPE_SETTER[field.type] as keyof DataView;
        (dataView[setter] as Function).call(dataView, abs, val, true);
        break;
      }
      case "array": {
        const Ctor = TYPE_ARRAY_CTOR[field.type];
        const src = val as unknown;
        if (!(src instanceof Ctor)) {
          throw new Error(
            `Expected ${Ctor.name} for array field "${key}", got ${valueName(src)}`,
          );
        }

        const length = field.count * ARRAY_VIEW_LENGTH_MULTIPLIER[field.type];
        if (src.length !== length) {
          throw new Error(`Array field "${key}" length mismatch: expected ${length}, got ${src.length}`);
        }

        const dst = new Ctor(dataView.buffer, dataView.byteOffset + abs, length);
        dst.set(src as never);
        break;
      }
      case "utf8": {
        if (typeof val !== "string") {
          throw new Error(`Expected a string for utf8 field "${key}", got ${typeof val}`);
        }
        const encoded = UTF8_ENCODER.encode(val);
        if (encoded.length > field.byteLength) {
          throw new Error(
            `Value for utf8 field "${key}" exceeds byteLength ${field.byteLength}: ${encoded.length} bytes`,
          );
        }

        const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset + abs, field.byteLength);
        bytes.fill(0);
        bytes.set(encoded);
        break;
      }
      case "nested": {
        if (typeof val !== "object" || val === null || Array.isArray(val)) {
          throw new Error(`Expected object value for nested field "${key}"`);
        }
        writeFields(field.layout, dataView, val as Partial<SchemaWriteValues<SchemaDefinition>>, abs);
        break;
      }
    }
  }
}
