import { Entity, World, world } from "@minecraft/server";

// --- utils ---

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type StringKeyOf<T> = Extract<keyof T, string>;

// --- implementation ---

/** A cache for document instances for each entity. */
let ownerIdDocumentMap = new Map<string, Document>();

/** Handles the modification of dynamic properties. */
export class Document<
  T extends { [key: string]: any } = { [key: string]: unknown }
> {
  /** The maximum length of a single dynamic property. Document values are not limited to this length. */
  static readonly MAX_DYNAMIC_PROPERTY_SIZE = 32767;

  /** The entity or world whose dynamic properties are being accessed. */
  readonly owner: World | Entity;

  protected constructor(owner: World | Entity) {
    this.owner = owner;
  }

  /**
   * Gets the document for a world or entity or creates it if it didn't already exist.
   * @param owner The entity or world you would like to get the document for.
   * @returns The world or entity's document.
   */
  static from<T extends { [key: string]: any } = { [key: string]: unknown }>(
    owner: World | Entity
  ): Document<T> {
    if (owner instanceof World) {
      if (worldDocument === undefined) return new this<T>(owner);
      return worldDocument as unknown as Document<T>;
    }

    let document = ownerIdDocumentMap.get(owner.id);
    if (document === undefined) {
      document = new this(owner);
      ownerIdDocumentMap.set(owner.id, document);
    }

    return document as unknown as Document<T>;
  }

  private setEncoded(key: StringKeyOf<T>, encodedValue: string): void {
    // delete it first since if the value is smaller than the last set value,
    // some chunks may not be overwritten and may be forgotten.
    this.delete(key);

    let chunkStart = 0;
    let chunkEnd = 0;
    let chunkId = 0;

    while (chunkStart < encodedValue.length) {
      // get next chunk
      chunkEnd = Math.min(
        encodedValue.length,
        chunkStart + Document.MAX_DYNAMIC_PROPERTY_SIZE
      );
      let chunk = encodedValue.slice(chunkStart, chunkEnd);
      chunkStart = chunkEnd;

      // set chunk
      this.owner.setDynamicProperty(`${key}_${chunkId}`, chunk);
      chunkId++;
    }
  }

  private getChunkIds(key: StringKeyOf<T>): string[] {
    let escapedKey = escapeRegExp(key);
    let keyPattern = new RegExp(`^${escapedKey}_\\d+$`);
    return this.owner
      .getDynamicPropertyIds()
      .filter((propId) => keyPattern.test(propId));
  }

  private getEncoded(key: StringKeyOf<T>): string | undefined {
    let ids = this.getChunkIds(key);

    if (ids.length === 0) {
      return undefined;
    } else {
      return ids.reduce(
        (data, id) => data + this.owner.getDynamicProperty(id),
        ""
      );
    }
  }

  /**
   * Returns the value associated with a key.
   * @param key The key to get the value of.
   */
  get<K extends StringKeyOf<T>>(
    key: K,
    decoder?: (encodedValue: string, key: K) => T[K]
  ): T[K] | undefined {
    const encodedValue = this.getEncoded(key);

    if (encodedValue === undefined) return undefined;

    if (typeof encodedValue === "string")
      return decoder?.(encodedValue, key) ?? JSON.parse(encodedValue);

    throw new Error(
      `Expected a string value from a dynamic property. Recieved ${typeof encodedValue}`
    ); // TODO: better errors
  }

  /**
   * Sets the value of a key.
   * @param key The key to set the value of.
   * @param value The value that will be set to the key.
   */
  set<K extends StringKeyOf<T>>(
    key: K,
    value: T[K],
    encoder?: (value: T[K], key: K) => string
  ): void {
    const encodedValue = encoder?.(value, key) ?? JSON.stringify(value);

    if (typeof encodedValue !== "string")
      throw new Error(
        `The encoded value must be a string value. Recieved ${typeof encodedValue}`
      ); // TODO: better errors

    this.setEncoded(key, encodedValue);
  }

  /**
   * Returns whether the document has the key.
   * @param key The key to check the existence of.
   */
  has(key: StringKeyOf<T>): boolean {
    let value: unknown;
    try {
      value = this.get(key);
      return value !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Removes a key from a document.
   * @param key The key to remove.
   */
  delete(key: StringKeyOf<T>): void {
    for (let id of this.getChunkIds(key)) {
      this.owner.setDynamicProperty(id, undefined);
    }
  }

  /**
   * Returns an iterator which yields every key the document contains.
   */
  *keys(): IterableIterator<StringKeyOf<T>> {
    let keys = new Set<string>();

    for (let id of this.owner.getDynamicPropertyIds()) {
      let idSeperatorIdx = id.lastIndexOf("_");
      if (idSeperatorIdx === -1) continue;

      let key = id.slice(0, idSeperatorIdx) as StringKeyOf<T>;
      if (keys.has(key)) continue;

      keys.add(key);
      yield key;
    }
  }

  /**
   * Returns an iterator which yields every value stored within every key the document contains.
   */
  *values(): IterableIterator<T[StringKeyOf<T>]> {
    for (let key of this.keys()) yield this.get(key);
  }

  /**
   * Returns an iterator which yields key-value pairs of every entry in the document.
   */
  *entries(): IterableIterator<[StringKeyOf<T>, T[StringKeyOf<T>]]> {
    for (let key of this.keys()) yield [key, this.get(key)];
  }
}

/** The world document. */
export const worldDocument = Document.from(world);

// Remove entities from the instance cache once they have been removed from the world to prevent a memory leak
world.afterEvents.entityRemove.subscribe((ev) =>
  ownerIdDocumentMap.delete(ev.removedEntityId)
);
