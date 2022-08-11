# 🌲 fir

[![Coveralls coverage badge](https://img.shields.io/coveralls/github/jackson-at-bentley/fir?color=green&logo=coveralls&style=flat-square)](https://coveralls.io/github/jackson-at-bentley/fir) [![NPM version badge](https://img.shields.io/npm/v/fir-for-connectors?color=yellowgreen&logo=npm&style=flat-square)](https://www.npmjs.com/package/fir-for-connectors)

## What?

An experimental, declarative synchronizer for iTwin connectors that aims to modify the existing types in the iTwin library as little as possible. For use as a drop-in replacement of the synchronizer in iTwin's connector framework.

### Navigation

- [Motivation 🔍](#motivation-)
- [Getting started 🌱](#getting-started-)
- [Extending `fir` ⚡](#extending-fir-)
- [Docs 📄](https://jackson-at-bentley.github.io/fir)

### What does it look like?

Like the element properties you already know from iTwin.

```ts
const linkPartition: Element<InformationPartitionElementProps> = {
    classFullName: LinkPartition.classFullName,
    code: Code.createEmpty(),
    model: 'repository',
    parent: 'root subject',
    meta: partitionMeta,
    description: 'models my links',
    to: toElement,
};
```

## Motivation 🔍

> The iTwin connectors team already maintains two connector libraries.
>
> 1. [`@itwin/connector-framework`](https://github.com/iTwin/connector-framework)
> 2. [`@itwin/pcf`](https://github.com/iTwin/pcf)
>
> Why do we need a third?

I've been [rather vocal](https://github.com/iTwin/connector-framework/pull/55) about the usability of the API of the synchronizer that ships with `@itwin/connector-framework`. This is an internship project and I have no expectation that it be maintained. I had an idea for how I wanted a synchronizer to work and I also wanted to use it, and that required writing it.

`fir` is _only_ a synchronizer. Its synchronization module is just over 400 lines of code. `fir` makes no attempt to be a complete solution to connectors like `pcf`, and it doesn't help you run your connector like `connector-framework`. It's designed to be dropped into the connector framework, and doesn't replace it.

### Benefits

- **Type safety.** The iTwin API represents elements as bags of properties that are just plain object types in TypeScript. When inserting elements into an iModel, all of these types are narrowed to `ElementProps`. These objects already have relationships to each other through _ECInstanceIds_, which are simply the IDs of rows in an iModel's underlying SQLite database. It seems natural then to use these objects as an intermediate representation of an iModel and hang strings between them to relate them instead of IDs. This is exactly what `fir` does. By expanding iTwin's existing types, you'll never mistake the type of a property. Your connector won't compile. This is in contrast to `pcf`'s approach, which trusts that the author of `modifyProps` won't make a mistake when escaping TypeScript's checks with `any`.
- **Automatic dependencies.** `fir` manages dependencies for you. If you forget to give an element `A` to the `sync` method, that's okay! If an element `B` is synced, all of its dependencies will be inserted into the iModel. If `B` is a child of `A`, for example, `A` and all of its dependencies will be inserted. These are the strings I mentioned above, but more formally they're relationships, called _navigation properties_ in BIS. Scope relationships, repository relationships, parent relationships, model relationships.
- **Models.** Unlike `pcf` and `connector-framework`'s synchronizer, `fir` places _no restrictions_ on models. Models can contain models arbitrarily deep. The current synchronizer does not operate on models and relies on the connector author to manage them. In `pcf` you can only have models that model partition elements that are children of the root subject.
- **Extendibility.** If an object type has a relationship property that I forgot to handle, `fir` will give control to the connector author to map the element to its "props" type in iTwin.

### Caveats

- For ease of use, like `pcf`, `fir` _does_ place constraints on the shape of your iModel. There are four.
    1. Think of the `ElementProps` type as having an `externalSourceAspect` property instead of the `ExternalSourceAspectProps` type having an `element` property. This allows `fir` to walk the intermediate iModel tree and find and insert all of the dependencies of the `sync` argument.
    2. Circular dependencies are impossible to write declaratively. If any of the strings you hang between your object types together form a circle, you can't represent that iModel with `fir`. This becomes a problem when (1) is considered. Usually all of the dependencies point up the tree towards the root; a parent must be inserted before its child so the child knows its ID. But now elements point towards their external source aspects. Consider an element `A` which points to its external source aspect, which points to an external source, which points to a repository. If this repository is contained in a link model, and its modeled element is `A`, that's a cycle. It may be necessary to design around this constraint by having separate sources that are not logically separate. You may also omit the external source element if the element is entirely programmatically generated. For example, in the diagram of the cycle below, it may make sense for the link partition to not belong to an external source.
    3. Scope paths must terminate at the root subject. If an element `A` is scoped to an element `B` through its external source aspect, then `B` is a dependency of `A`, and we must know `B`'s ID before we can insert `A`. Because every element in `fir` has an external source aspect, we need to locate `B` before we can insert it, which requires knowing its scope. Unless we eventually resolve an element's scope to the root subject with known ID `IModel.rootSubjectId`, `fir` will never terminate as it tries to locate each element in the chain.
    4. Elements must have exactly one external source aspect. This is not a technical limitation. I just haven't implemented it yet.

![A diagram of the iModel described in the second caveat](https://github.com/jackson-at-bentley/fir/blob/main/images/cycle.svg?raw=true)

## Getting started 🌱


```text
npm install --save fir-for-connectors
```

If you're doing your own imports of the iTwin libraries you may encounter a duplicate native library. I need to do more testing to figure out how to properly package `fir`, for example, so it can be used in `connector-framework`. If you're just using `fir` without `connector-framework` everything should work fine.

```ts
import type { Element, Meta, Model  } from 'fir-for-connectors';
import { Sync, toElement, toModel } from 'fir-for-connectors';
```

Let's say we want to add [a link](https://www.itwinjs.org/bis/domains/biscore.ecschema/#urllink) to our iModel. We know that the corresponding BIS element is a `BisCore:UrlLink`. We search the [iTwin API](https://www.itwinjs.org/reference) for _url link_ and see [`UrlLinkProps`](https://www.itwinjs.org/reference/core-common/entities/urllinkprops). `UrlLinkProps` extends `ElementProps`, so we can use it with `fir`. Generally, anything with a _props_ at the end is fair game. We're adding an element, so we define an object of type `Element` and feed it the props we found.

```ts
const nationalGeographic: Element<UrlLinkProps> = {
    classFullName: UrlLink.classFullName,
    code: Code.createEmpty(),
    model: linkModel,
    meta,
    description: 'the homepage of national geographic',
    url: 'https://nationalgeographic.com',
    to: toElement,
};
```

This type should look familiar if you're used the iTwin API before. It's nearly identical to `UrlLinkProps`. There are a couple important differences.

The `model` property isn't an ID, an `Id64String`. It's another object.

```ts
const linkModel: Model<ModelProps> = {
    classFullName: LinkModel.classFullName,
    parentModel: 'repository',
    modeledElement: linkPartition,
    to: toModel,
};
```

`linkPartition` isn't shown, it's just an `Element<InformationPartitionElementProps>`. It's okay if the props type doesn't match up with BIS element you want. Just use the closest one, the youngest ancestor props type of the BIS element. You'll see a [`LinkPartition`](https://www.itwinjs.org/reference/core-backend/elements/linkpartition) if you're searching the iTwin API. It doesn't end in _props_ so we can't use that directly. (There are ways to use the iTwin class types with `fir`, we'll talk about that later.)

Let's go back to the URL link.

There's a strange property called `to`. This tells `fir` how to convert its weird node type to `ElementProps`. It's boilerplate most of the time, but it also makes `fir` extendible and allows us to become the synchronizer if you need more power. We'll come back to this.

Try deleting the `to` property. If you're using an editor with a language server, it will show a bunch of red squiggles and your code won't compile. This is TypeScript in action telling you the `to` property is required. Same deal with `code`, a property of `UrlLinkProps`. Try deleting that too and see what happens.

If you hover over the squiggle, you'll see a verbose and worrying error message from your friendly compiler.

```text
*a few lines of noise*
Property 'to' is missing in type '*noise*' but required in type 'ElementPatch'. ts(2322)
nodes.ts(53, 5): 'to' is declared here.
```

That's okay, `fir` does some weird type stuff to make it work that probably could be done better if I knew how to write TypeScript. All we need is the very last line. It says the property `to` is missing!

The other property that's not in iTwin is `meta`. This is what `fir` calls external source aspects, another "thing" in your iModel, similar to an element, where the metadata of your elements is stored, like their versions and checksums. `fir` uses this information to see when an element has changed.

```ts
const meta: Meta = {
    classFullName: ExternalSourceAspect.classFullName,
    scope: linkPartition,
    anchor: 'national geographic url',
    kind: 'json',
    version: '1.0.0',
};
```

If you ever want to refer to the root subject, use `'root subject'`. If you want to refer to the repository model, use `'repository model'`.

The `anchor` property is a unique ID for your element, so `fir` knows how to find it in the iModel. It's the same thing as `identifier` in `BisCore:ExternalSourceAspect`.

URLs don't usually have parent elements, but if your want to give your element a parent you can do that with the `parent` property. We give it either an `Element` or an `{ element: Element, relationship: string }`. Use the latter form if you want to specify the type of parent-child relationship. If you use the first kind `fir` will try to guess, but it will probably use `BisCore:ElementOwnsChildElements`.

Okay, we're almost done! All that's left is to tell `fir` to sync our element. To do that, we need a synchronizer. `imodel` is your `IModelDb`.

```ts
const fir = new Sync(imodel);
fir.sync(nationalGeographic);
```

That's it! If you change that version number because you made a patch to your iModel, say to `1.0.1`, `fir` will update the element. Otherwise it will skip it.

There's one more useful method you'll need to know. If you

```ts
const id: Id64String = fir.put(nationalGeographic);
```

you'll get the ID of the link in the iModel, the _ECInstanceId_. You can feed it to other functions in the iTwin API that do useful things, like define relationships. `put` works like the shell program `touch`. It puts an element in the iModel if it doesn't exist and returns its ID. It will _never_ update the element. Use `sync` for that.

### Tree trimming

Now that we've got the synchronization all done, we need to ensure that our source data remains the 'single source of truth' for our iModel. This means that each we can define a bijection between the source objects and the iModel objects. For example, if we change the modeled element of a model in the source, we expect the model to be _moved_ in the iModel, and not copied.

`fir` will not do this for you unless you tell it to.

```ts
fir.trim('root subject');
```

The `trim` method takes a subtree of the iModel, a branch, and deletes all of the elements and models that weren't seen during the lifetime of the `Sync` object and whose children were not seen. The root subject is a good place to call this because most of the iModel descends from it unless you have elements floating in the cytoplasm of the repository model.

Make sure to clean up those too, like repositories and external sources.

It may take multiple passes to remove untouched elements from the iModel depending on how the iModel is traversed. Geometry can prevent definition elements from getting cleaned up during a first pass for [reasons I don't entirely understand](https://www.itwinjs.org/reference/core-backend/imodels/imodeldb/imodeldb.elements/deletedefinitionelements).

### Can I see an example connector?

Absolutely! Take a look at the integration folder, which has `test-connector.ts`. It's the same test connector in `connector-framework` but it's written in `fir`. Currently it's hard-coded in version `1.0.0` so `fir` won't actually update the elements.

### More iModel things

`fir` supports these iModel things.

- Elements with the `Element` type.
- Models with the `Model` type.
- Aspects with the `Aspect` type. Use `Meta` for external source aspects. Note the `aspects` property on `Element`. The caveat is that aspects cannot have navigation properties until the iTwin API allows you to get their ID.
- Link-table relationships with the `Relationship` type. These take a little bit of care. They have an `anchor` property for provenance. You can't feed them to `sync` because if any part of a relationship changes it's considered a different relationship: anchor, class, source, or target. Use `put` instead.
- Navigation properties by [extending or escaping the library](#extending-fir-). `fir` comes with the common ones, like parent-child relationships and element-model relationships.

### Growing taller

Syncing an element requires specifying an awful lot of properties that probably seem redundant. Why should I have to define the BIS class of the element I want to insert? Or the code? Doesn't iTwin know how to make these things for me?

The 'props' types that we've been using offer a thin wrapper around the underlying database, by design. For a better experience, the iTwin authors made class types that do a lot of this work for you. They usually have a `create` method or a constructor function. Let's take a look at an example from the test connector in this repository.

```ts
const category = SpatialCategory.create(
    fir.imodel, fir.put(definitionModel), 'TestConnector'
);

const props: Element<CategoryProps> = {
    ...category.toJSON(),
    model: definitionModel,
    parent: undefined,
    meta: meta('Category', '1.0.0', repository, source),
    description: "I don't know what this root category is for yet.",
    rank: Rank.Application,
    to: toElement,
};
```

When we touch the iTwin APIs we have to make use of `put`, because the iTwin APIs talk in IDs. Notice we don't specify the class name or the code. Instead, after we construct the class type, we use `toJSON` to convert the class type into `CategoryProps`, then the spread `...` operator to add it to `fir`'s element type. If you stop there you have an object of type `CategoryProps`. We have to overwrite the stuff `fir` needs to know about, like the model that contains the element. Then we can add properties the class type doesn't define, like the category description.

The parent property looks weird, because it's `undefined`. At runtime, TypeScript can't know that `SpatialCategory` doesn't actually use that parent property. All it knows from the type of `toJSON` is that it _could_ use it and that its type is `Id64String`. We have to tell TypeScript that this property actually has the type `fir` expects, which is an optional `Element`. We explicitly write `undefined`, because this optional property is (from my understanding) equivalent to `Element | undefined`. This is structural typing after all, and a missing property is a different structure.

## Extending `fir` ⚡

Let's say we want to add a [`Bis:ExternalSourceAttachment`](https://www.itwinjs.org/bis/domains/biscore.ecschema/#externalsourceattachment) to our iModel. I don't know what this is, but it has a navigation property so we can't yet use it with `fir`. Here's what we need to do.

```ts
type ExternalSourceAttachment<P extends ExternalSourceAttachmentProps = ExternalSourceAttachmentProps> =
    Omit<ElementNode<P>, keyof ExternalSourceAttachmentPatch>
        & ExternalSourceAttachmentPatch;

type ExternalSourceAttachmentPatch = {
    attaches?: Source,
    to: To<ExternalSourceAttachment<ExternalSourceAttachmentProps>, ExternalSourceAttachmentProps>
};

function toExternalSourceAttachment(sync: Sync, attachment: ExternalSourceAttachment): ExternalSourceAttachmentProps
{
    return {
        ...toElement(sync, attachment),
        attaches: attachment.attaches ? {
            id: sync.put(attachment.attaches),
            relClassName: ExternalSourceAttachmentAttachesSource.classFullName
        } : undefined
    };
}
```

The `ElementNode` type nestled in there is `fir`'s element type. The only difference between it and `Element` is that `Element` can also be `'root subject'`, and we can't use `Omit` on a union type because it doesn't distribute across the union.

We define our own intermediate type `ExternalSourceAttachment`. Be careful that you don't also have a type of the same name from `@itwin/core-backend`. I like to use qualified imports for the iTwin libraries so I don't confuse myself. This type looks horrific, but all we're doing is feeding the 'props' type argument _P_ to `fir`'s element type, which will construct an element type that `fir` knows how to use. Then we apply our own patch to the result, stripping off the old `attaches` property and giving it a different type, an external source, called `Source` in `fir` for easy access.

Finally, we have to tell `fir` how to map this new intermediate type to its 'props' type in the iTwin library. This is done with a `to` function as I mentioned earlier.

First, we call `toElement`, which you'll remember from all the elements we made above. This turns `fir`'s element type `Element` into `ElementProps`. We dump it into our `ExternalSourceAttachmentProps` and add the `attaches` property to complete the type. We make use of `put` to get the ID of the external source this element refers to.

This process can be kind of dangerous, and I'm still searching for a better design. Here's why.

![A diagram of fir's type tree. Caption reads, "Dashed nodes are convenience types with the type argument defaulted; solid nodes are used when extending the library. The node at the tail of an arrow is a supertype of the node at the head."](https://github.com/jackson-at-bentley/fir/blob/main/images/types-tree.svg?raw=true)

It turns out we got lucky with this example. When we call `toElement` we're trying to assign our `ExternalSourceAttachment` type to an `Element` type. This would be a beautiful case of type narrowing if it weren't for the `to` properties on the two types. In TypeScript, if you assign a function `f` to another function `g` by writing `g = f`, the function `f` must have at most as large a domain as `g`, because functions that have type `typeof g` give no indication that they do anything with the excess input, like our `attaches` property. They may even explode. In our case `toElement` will happily dump everything it receives into the `ElementProps`.

If the BIS specifications said that the `attaches` relationship is mandatory, we'd have a problem. `Element`'s `to` type doesn't allow that property. We can use `as unknown as Element` to tell TypeScript that we're sure the `to` function will never be invoked without an `attachment` property.

A better solution is a utility function to safely perform the extraction.

> That's a lot of work and boilerplate for a new navigation property.

Yeah, it is. There are two solutions.

1. Rely on the iTwin library to define referencing relationships. I wrote the test connector without having to define a new intermediate element type. Most BIS classes don't define new navigation properties, and if they do hopefully they have a `create` that does all of that for you.
2. Use something like `Element<ExternalSourceAttachmentProps>` with `toElement`; remember that only the `to` types prevent narrowing. Then just use `put` for the `attaches` navigation property. Because there's no intermediate `fir` type, any additional properties that you give to your element will be handed to the iTwin library.

> Dude it's your library. The whole point of `fir`'s 'tree' of element types is that each one is a supertype of its parent. The `to` function is bad design because it prevents narrowing when the supertypes aren't directly assignable to their parent, in which case _they're not supertypes_ but overlapping types.

I'm working on it. In the mean time `strictFunctionTypes` is the compiler option that's causing this error. There's no way to say to the compiler, hey, I know this thing isn't a supertype, but I pinky swear that the other type we're binding it to isn't going to invoke its `to` function without the value we're hiding from its domain.

## Road map and scattered thoughts 🚗

- [ ] _urgent!_ Need to figure out how to design the node types to allow the `to` function to properly narrow; otherwise, syncing is going to be difficult with elements with mandatory properties
- [ ] Test the published package in `connector-framework`
- [ ] Sync element aspects
- [ ] Support more than one external source aspect
- [ ] Utility function to safely extract the `Element` type out of other element types
- [ ] Are there any class types that insert other elements into the iModel? `fir` won't know
- [x] What about syncing `RelationshipProps`? Link table relationships should never cause cycles
- [x] Document the `trim` method
- [x] Trim untethered external sources and repositories. Can we use `trim`?
- [x] Trim a model
