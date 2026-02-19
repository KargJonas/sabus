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

export type SchemaDefinition = Record<string, Type>;

export type SchemaValues<S extends SchemaDefinition> = {
  [K in keyof S]: number;
};

interface FieldLayout {
  type: Type;
  offset: number;
}

export interface Layout<S extends SchemaDefinition> {
  fields: { [K in keyof S]: FieldLayout };
  byteLength: number;
}

export function computeLayout<S extends SchemaDefinition>(schema: S): Layout<S> {
  let offset = 0;
  const fields = {} as { [K in keyof S]: FieldLayout };

  for (const key of Object.keys(schema) as (keyof S & string)[]) {
    const type = schema[key];
    const size = TYPE_SIZE[type];
    const align = size;
    offset = Math.ceil(offset / align) * align;
    fields[key] = { type, offset };
    offset += size;
  }

  return { fields, byteLength: offset };
}

export function readSnapshot<S extends SchemaDefinition>(
  layout: Layout<S>,
  dataView: DataView,
): SchemaValues<S> {
  const out = {} as SchemaValues<S>;
  for (const key of Object.keys(layout.fields) as (keyof S & string)[]) {
    const field = layout.fields[key];
    const getter = TYPE_GETTER[field.type] as keyof DataView;
    out[key] = (dataView[getter] as Function).call(dataView, field.offset, true) as number;
  }
  return out;
}

export function writeFields<S extends SchemaDefinition>(
  layout: Layout<S>,
  dataView: DataView,
  values: Partial<SchemaValues<S>>,
): void {
  for (const key of Object.keys(values) as (keyof S & string)[]) {
    const field = layout.fields[key];
    const setter = TYPE_SETTER[field.type] as keyof DataView;
    (dataView[setter] as Function).call(dataView, field.offset, values[key], true);
  }
}
