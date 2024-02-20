import { Entity, World, world } from "@minecraft/server";

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let ownerIdDocumentMap = new Map<string, Document>();

export class Document {
  static readonly MAX_DYNAMIC_PROPERTY_SIZE = 32767;

  readonly owner: World | Entity;

  protected constructor(owner: World | Entity) {
    this.owner = owner;
  }

  static from(owner: World | Entity): Document {
    if (owner instanceof World) {
      if (worldDocument !== undefined) return worldDocument;
      else return new this(owner);
    }

    let document = ownerIdDocumentMap.get(owner.id);
    if (document === undefined) {
      document = new this(owner);
      ownerIdDocumentMap.set(owner.id, document);
    }

    return document;
  }

  private setEncoded(key: string, encodedValue: string): void {
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

  private getChunkIds(key: string): string[] {
    let escapedKey = escapeRegExp(key);
    let keyPattern = new RegExp(`^${escapedKey}_\\d+$`);
    return this.owner
      .getDynamicPropertyIds()
      .filter((propId) => keyPattern.test(propId));
  }

  private getEncoded(key: string): string | undefined {
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

  get<T = unknown>(key: string): T | undefined;
  get<T = unknown>(
    key: string,
    decoder?: (encodedValue: string) => T
  ): T | undefined;
  get<T = unknown>(
    key: string,
    decoder?: (encodedValue: string) => T
  ): T | undefined {
    const encodedValue = this.getEncoded(key);

    if (encodedValue === undefined) return undefined;

    if (typeof encodedValue === "string")
      return (decoder ?? JSON.parse)(encodedValue);

    throw new Error(
      `Expected a string value from a dynamic property. Recieved ${typeof encodedValue}`
    ); // TODO: better errors
  }

  set<T = unknown>(key: string, value: T): void;
  set<T = unknown>(key: string, value: T, encoder?: (value: T) => string): void;
  set<T = unknown>(
    key: string,
    value: T,
    encoder?: (value: T) => string
  ): void {
    const encodedValue = (encoder ?? JSON.stringify)(value);

    if (typeof encodedValue !== "string")
      throw new Error(
        `The encoded value must be a string value. Recieved ${typeof encodedValue}`
      ); // TODO: better errors

    if (encodedValue.length > Document.MAX_DYNAMIC_PROPERTY_SIZE)
      throw new Error(
        `The encoded value must be less than ${Document.MAX_DYNAMIC_PROPERTY_SIZE} characters long.`
      ); // TODO: better errors

    this.setEncoded(key, encodedValue);
  }

  has(key: string): boolean {
    let value = this.owner.getDynamicProperty(key);
    return value !== undefined && typeof value === "string";
  }

  delete(key: string): void {
    this.owner.setDynamicProperty(key, undefined);
  }

  *keys(): IterableIterator<string> {
    for (let id of this.owner.getDynamicPropertyIds()) {
      let value = this.owner.getDynamicProperty(id);
      if (typeof value === "string") yield id;
    }
  }

  *values(): IterableIterator<unknown> {
    for (let id of this.owner.getDynamicPropertyIds()) {
      let value = this.owner.getDynamicProperty(id);
      if (typeof value === "string") yield value;
    }
  }

  *entries(): IterableIterator<[string, unknown]> {
    for (let id of this.owner.getDynamicPropertyIds()) {
      let value = this.owner.getDynamicProperty(id);
      if (typeof value === "string") yield [value, id];
    }
  }
}

/** The world document. */
export const worldDocument = Document.from(world);

// Remove entities from the instance cache once they have been removed from the world to prevent a memory leak
world.afterEvents.entityRemove.subscribe((ev) =>
  ownerIdDocumentMap.delete(ev.removedEntityId)
);
