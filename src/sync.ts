/*--------------------------------------------------------------------------------------------------
 * Copyright (c) Bentley Systems, Incorporated. All rights reserved.
 * See LICENSE.md in the project root for license terms and full copyright notice.
 *------------------------------------------------------------------------------------------------*/

import * as backend from '@itwin/core-backend';
import * as bentley from '@itwin/core-bentley';
import * as common from '@itwin/core-common';

import {
    Aspect,
    Element,
    Entity,
    Meta,
    Model,
    Relationship,
    Repository,
    Source,
} from './nodes.js';

import {
    childrenOfElement,
    childrenOfModel,
    isManaged,
    modelOf,
} from './queries.js';

/**
 * This type is fed to the mapping functions, like {@link Sync#mapElement}, to let them know how to
 * map a `fir` type to an iTwin 'props' type.
 *
 * @internal
 */
type State = { state: 'update', id: bentley.Id64String } | { state: 'new' };

/**
 * A relationship is identified by a triple, not only by its ID? The relationship APIs require this
 * (class, source, target) triple to delete a relationship, but only its class to update a
 * relationship. But the update functionality seems broken, so we opt for deleting.
 *
 * @internal
 */
type RelationshipState = {
    state: 'update',
    id: bentley.Id64String,
    fullClass: string, source: bentley.Id64String, target: bentley.Id64String
} | { state: 'new' };

/**
 * Tree-trimming statistics.
 *
 * @todo Include statistics on deleted link-table relationships and navigation properties! o:
 */
export type Trim = {
    deletedElements: number,
    deletedModels: number,
    deletedAspects: number
};

/**
 * An element can either be new or changed, because the library relies on {@link Sync#put} to insert
 * an element if it does not exist. This type is returned by {@link Sync#changed}.
 *
 * @internal
 */
type Change = 'changed' | 'unchanged';

/**
 * The result of reading a JSON tag.
 *
 * @internal
 */
type Read = {
    success: true,
    payload: unknown,
} | {
    success: false,
};

/**
 * A function type to map `fir`'s representation of branches in an iModel, like elements and models,
 * to its corresponding iTwin 'props' type. For example, {@link toElement} maps an
 * {@link nodes!Element} to an
 * [`ElementProps`](https://www.itwinjs.org/reference/core-common/entities/elementprops). `fir`
 * makes sure that each of these functions starts with the prefix `to` for visibility.
 *
 * Importantly, these functions _may have side effects_ and write their dependencies to the iModel.
 * For example, `toSource` will insert its repository if it exists because it must know its ID to
 * construct its 'props' type.
 *
 * Connector authors can define their own function of this type to take control of the synchronizer.
 */
export type To<N extends Entity, E extends common.EntityProps> = (sync: Sync, node: N) => E;

export function toElement<E extends Element>(sync: Sync, element: E): common.ElementProps
{
        if (element === 'root subject') {
            throw Error('fatal: cannot form props of root subject 💥');
        }

        const elementProps: common.ElementProps = {
            ...element,
            model: sync.put(element.model), // The mapped model.
            parent: undefined,              // TODO: Hack. Prefer no property if no parent.
        };

        // Resolve the parent relationship. The parent must be inserted into the iModel before its
        // child.

        if (element.parent) {
            let relationship: string | undefined;
            let parent: Element | undefined;

            // Dangerous runtime narrowing. If your element has a property called 'relationship'
            // TypeScript will confuse the element with the relationship.

            if (element.parent === 'root subject') {
                elementProps.parent = new backend.SubjectOwnsPartitionElements(
                    common.IModel.rootSubjectId
                );
            } else {
                if ('relationship' in element.parent) {
                    parent = element.parent.element;
                    relationship = element.parent.relationship;
                } else {
                    parent = element.parent;
                }

                // TODO: Redundant type narrowing and checking for root subject in resolve. We know
                // that the parent is not the root subject when we resolve it here but put expects
                // an Element, not Omit<Element, 'root subject'>.

                elementProps.parent = {
                    id: sync.put(parent),
                    relClassName: relationship ?? resolveParentClass(parent),
                };
            }
        }

        return elementProps;
}

/**
 * Attempt to infer the relationship a child has with its parent element by inspecting its
 * parent.
 *
 * A cinder block will probably outperform `fir` here as written. The difficulty comes from
 * my lack of familiarity with BIS and how
 * [RelatedElementProps](https://www.itwinjs.org/reference/core-common/entities/relatedelementprops)
 * is handled internally, because the `relClassName` is allowed to be `undefined`. I don't know
 * when it's necessary to specify this property. Inherited classes will have problems if the
 * backend isn't inferring the relationship type from the schema.
 */
function resolveParentClass<E extends Element>(parent: E): string
{
    // Attempt to infer the class of the parent.

    if (parent === 'root subject') {
        // TODO: The only children of the root subject are partition elements?
        return backend.SubjectOwnsPartitionElements.classFullName;
    } else if (parent.classFullName === backend.Category.classFullName) {
        // TODO: The only children of a category are subcategories?
        return backend.CategoryOwnsSubCategories.classFullName;
    }

    return backend.ElementOwnsChildElements.classFullName;
}

export function toSource<S extends Source>(sync: Sync, source: S): common.ExternalSourceProps
{
    const sourceProps: common.ExternalSourceProps = {
        ...toElement(sync, source),
        repository: source.repository ? { id: sync.put(source.repository) }: undefined,
    };

    return sourceProps;
}

export function toModel<M extends Model>(sync: Sync, model: M)
{
    if (model === 'repository') {
        throw Error('fatal: cannot form props of repository model 💥');
    }

    const modeledId = sync.put(model.modeledElement);

    const modelProps: common.ModelProps = {
        ...model,
        parentModel: model.parentModel ? sync.put(model.parentModel) : undefined,
        modeledElement: { id: modeledId },
    };

    return modelProps;
}

function toRelationship<R extends Relationship>(sync: Sync, relationship: R): common.RelationshipProps
{
    const sourceId = sync.put(relationship.source);
    const targetId = sync.put(relationship.target);

    const props: common.RelationshipProps = {
        sourceId, targetId,
        classFullName: relationship.classFullName,
    };

    return props;
}

export class Sync
{
    imodel: backend.IModelDb;

    /**
     * The set of IDs that the synchronizer has seen in its lifetime. `fir` uses this property to
     * determine which elements are safe to delete after synchronizing.
     *
     * @see Sync#trim
     */
    private touched: Set<bentley.Id64String> = new Set();

    /**
     * Stores provenance information for relationships.
     */
    private store: Repository;

    constructor(imodel: backend.IModelDb)
    {
        this.imodel = imodel;

        this.store = {
            classFullName: backend.RepositoryLink.classFullName,
            model: 'repository',
            code: backend.RepositoryLink.createCode(
                this.imodel, this.put('root subject'), 'fir-bookkeeping',
            ),
            meta: {
                classFullName: backend.ExternalSourceAspect.classFullName,
                scope: 'root subject',
                version: '0.0.0-pitch',
                kind: 'ts',
                anchor: 'fir-bookkeeping',
            },
            url: 'https://github.com/jackson-at-bentley/fir',
            description: 'Please don\'t touch me. fir needs me for bookkeeping.',
            to: toElement,
        };

        this.sync(this.store);
    }

    /**
     * Sync `fir`'s representation of a branch in an iModel with the iModel. If the external source
     * aspect of the element has changed, the element will be updated. This function will also
     * insert all of the dependencies of the element if its `to` function is correct.
     */
    sync<B extends Element | Model>(branch: B): void
    {
        if (branch === 'repository' || branch === 'root subject') {
            return;
        }

        // This narrowing is unsafe because structural typing, apparently. TypeScript doesn't
        // realize that a model may have a parent property defined on it because B extends Model, in
        // which case we're going to explode at runtime. TypeScript chooses to be permissive and
        // seems to assume that the extended types Element and Model don't share a common property.

        // See also: https://github.com/microsoft/TypeScript/pull/15256#discussion_r154843152

        if ('model' in branch) {
            this.syncElement(branch);
        } else if ('modeledElement' in branch) {
            this.syncModel(branch);
        } else {
            throw Error('fatal: sync narrowing failure; this is a 🐛');
        }
    }

    /**
     * Because we can only attach external source aspects to elements, a model does not have
     * information that anchors it to the source document. In BIS speak, this is _provenance_. Thus,
     * we only update the model if its modeled element has changed.
     *
     * @see Sync#sync
     */
    private syncModel<M extends Model>(model: M): void
    {
        if (model === 'repository') {
            return;
        }

        const modelId = this.putModel(model);

        if (this.changed(model.modeledElement) === 'changed') {
            this.mapModel(model, { state: 'update', id: modelId });
        }
    }

    private syncElement<E extends Element>(element: E): void
    {
        if (element === 'root subject') {
            return;
        }

        const elementId = this.put(element);

        if (this.changed(element) === 'changed') {
            this.mapElement(element, { state: 'update', id: elementId });
        }
    }

    /**
     * Insert `fir`'s representation of a branch in an iModel into the iModel. Its ID is returned.
     * If the branch already exists `fir` will not attempt to insert it again. I like to think of
     * it like the shell program `touch`.
     */
    put<B extends Element | Model| Relationship>(branch: B): bentley.Id64String
    {
        if (branch === 'repository') {
            return common.IModel.repositoryModelId;
        }

        if (branch === 'root subject') {
            return common.IModel.rootSubjectId;
        }

        // Unsafe narrowing, see Sync#sync.

        // See also: https://github.com/microsoft/TypeScript/pull/15256#discussion_r154843152

        if ('model' in branch) {
            return this.putElement(branch);
        }

        // Ditto.

        if ('modeledElement' in branch) {
            return this.putModel(branch);
        }

        if ('source' in branch) {
            return this.putRelationship(branch);
        }

        throw Error('fatal: put narrowing failure; this is a 🐛');
    }

    private putModel<M extends Model>(model: M): bentley.Id64String
    {
        if (model === 'repository') {
            return common.IModel.repositoryModelId;
        }

        const modeledId = this.putElement(model.modeledElement);
        const modelId = modelOf(this.imodel, modeledId);

        if (modelId) {
            return modelId;
        }

        return this.mapModel(model, { state: 'new' });
    }

    private putElement<E extends Element>(element: E): bentley.Id64String
    {
        // TODO: Detect and report scope cycles.

        // Put a single element in the iModel. Its dependencies must be inserted:
        // - All parents of the element, up to the root subject
        // - The external source aspects of the element, and their external sources and repositories

        if (element === 'root subject') {
            return common.IModel.rootSubjectId;
        }

        let { elementId } = this.meta(element);

        if (!elementId) {
            // The element does not exist in the iModel. Map the intermediate representation to
            // props.
            elementId = this.mapElement(element, { state: 'new' });
        }

        this.touched.add(elementId);
        return elementId;
    }

    /**
     * > Note that neither Models nor Aspects may be the source nor target of relationships in the
     * > link table, and therefore Models and Aspects cannot be involved in relationships with
     * > properties or relationships with (*..*) multiplicity.
     *
     * The {@link nodes!Relationship} type represents
     * [link-table relationships](https://www.itwinjs.org/bis/intro/relationship-fundamentals/#link-table).
     */
    private putRelationship<R extends Relationship>(relationship: R): bentley.Id64String
    {
        let id: bentley.Id64String;

        const read = this.readTag(
            this.store, relationship.anchor
        );

        type RelationshipMeta = { id: string, fullClass: string, source: string, target: string };

        let found: RelationshipMeta | null;
        if (read.success) {
            found = read.payload as RelationshipMeta;
        } else {
            found = null;
        }

        const fullClass = relationship.classFullName;
        const sourceId = this.put(relationship.source);
        const targetId = this.put(relationship.target);

        if (!found) {
            id = this.mapRelationship(relationship, { state: 'new' });

            // Tag the related elements so that the relationship in fir's store can be deleted if
            // either of the elements is deleted. The entry in the link table is deleted
            // automatically. I think.
            this.tag(relationship.source, relationship.anchor, null);
            this.tag(relationship.target, relationship.anchor, null);

            this.tag(this.store, relationship.anchor, {
                id, fullClass,
                source: sourceId, target: targetId
            });
        } else if (fullClass === found.fullClass && sourceId === found.source && targetId === found.source) {
            // No change has been made to the relationship. This means we've encountered the same
            // relationship and should just return its ID.
            id = found.id;
        } else {
            // Tag the related elements so that the relationship can be deleted if either of the
            // elements is deleted.

            if (sourceId !== found.source) {
                // The source has moved.
                this.cutTag(found.source, relationship.anchor);
                this.tag(relationship.source, relationship.anchor, null);
            }

            if (targetId !== found.target) {
                // The target has moved.
                this.cutTag(found.target, relationship.anchor);
                this.tag(relationship.target, relationship.anchor, null);
            }

            id = this.mapRelationship(relationship, {
                state: 'update',
                id: found.id,
                fullClass: found.fullClass, source: found.source, target: found.target
            });

            this.tag(this.store, relationship.anchor, {
                id, fullClass,
                source: sourceId, target: targetId
            });
        }

        return id;
    }

    /**
     * Map `fir`'s representation of a model to its iTwin 'props' type. The {@link State} type is
     * required because the iTwin libraries require an ID for an update operation. The mapping
     * functions aren't responsible for providing that ID; that's {@link Sync#sync}'s job.
     *
     * @internal
     */
    private mapModel<M extends Model>(model: M, state: State): bentley.Id64String
    {
        if (model === 'repository') {
            return common.IModel.repositoryModelId;
        }

        const modelProps = model.to(this, model);
        const json: Json = modelProps.jsonProperties;

        let modelId: bentley.Id64String;

        if (state.state === 'update') {
            modelId = modelProps.id = state.id;

            // Merge the user's JSON with the JSON properties of the element.
            const found = this.imodel.models.getModelProps(state.id);
            modelProps.jsonProperties = mergeJson(json, found.jsonProperties);

            this.imodel.models.updateModel(modelProps);
        } else {
            // Wrap the user's JSON properties in the user namespace.
            // if (json) {
            //     modelProps.jsonProperties = {
            //         UserProps: json,
            //     };
            // }

            modelId = this.imodel.models.insertModel(modelProps);
        }

        return modelId;
    }

    /**
     * @internal
     */
    private mapElement<E extends Element>(element: E, state: State): bentley.Id64String
    {
        if (element === 'root subject') {
            return common.IModel.rootSubjectId;
        }

        const elementProps = element.to(this, element);
        const json: { [property: string]: unknown } | undefined = elementProps.jsonProperties;

        let elementId: bentley.Id64String;

        if (state.state === 'update') {
            elementId = elementProps.id = state.id;

            // Merge the user's JSON with the JSON properties of the element.
            const found = this.imodel.elements.getElementProps(state.id);
            elementProps.jsonProperties = mergeJson(json, found.jsonProperties);

            this.imodel.elements.updateElement(elementProps);
        } else {
            // Wrap the user's JSON properties in the user namespace.
            // if (json) {
            //     elementProps.jsonProperties = {
            //         UserProps: json,
            //     };
            // }

            elementId = this.imodel.elements.insertElement(elementProps);
        }

        const meta = element.meta;

        const externalAspectProps = this.toExternalAspect(elementId, meta);

        if (state.state === 'update') {
            // Bypass the aspect API; currently no way to obtain the ID of an aspect.
            const { aspectId } = this.meta(element);
            externalAspectProps.id = aspectId;
            this.imodel.elements.updateAspect(externalAspectProps);
        } else {
            this.imodel.elements.insertAspect(externalAspectProps);
        }

        // Currently the iTwin APIs don't allow you to get a handle on aspects after inserting them
        // into the iModel. Because there's no way to track their provenance in BIS, and no way
        // to track their provenance without extending the class, for now we just delete and
        // reinsert them. This isn't an ideal implementation because we consider ourselves a
        // synchronizer. The structural schema relies heavily on aspects, for example.

        if (element.aspects) {
            const stale = this.imodel.elements.getAspects(elementId);
            this.imodel.elements.deleteAspect(
                stale
                    .filter(aspect => aspect.classFullName !== backend.ExternalSourceAspect.classFullName)
                    .map(aspect => aspect.id)
            );
        }

        for (const aspect of element.aspects ?? []) {
            const aspectProps = this.toAspect(elementId, aspect);
            this.imodel.elements.insertAspect(aspectProps);
        }

        return elementId;
    }

    /**
     * This mapping function doesn't look like the rest, because its first parameter is the ID of
     * the element that owns the external source aspect. This is because we've reversed the
     * dependency in our element type compared to the iTwin type. Our element type refers to the
     * aspect, while iTwin's aspect type refers to the element, just like the BIS navigation
     * property. Thus, there's no way to resolve the BIS dependency with only the aspect; we can't
     * traverse backwards from our aspect type to our element type.
     *
     * This design decision also means we can't use `to` functions with aspects, because we'd have
     * to supply the ID of the owning element.

     * > Aspects are only allowed as the source of relationships behind navigational properties, or
     * > as the target of element-owns-aspect relationships.

     * [Here's my source](https://www.itwinjs.org/bis/intro/relationship-fundamentals/#supported-relationship-capabilities)
     * for that quote, straight from Casey.
     *
     * We're already handling the latter, and but I _think_ the former means that aspects are
     * allowed to have navigation properties, which will not be supported until the iTwin APIs allow
     * you to locate the ID of an aspect you've inserted. Then we'll have to decouple the aspect
     * type from the external aspect type, and make it point to the element, and not vice versa.
     */
    private toExternalAspect(elementId: bentley.Id64String, meta: Meta): common.ExternalSourceAspectProps
    {
        // Resolve the scope. Because every element except the root subject has an external source
        // aspect, the scope path of any element must eventually terminate at the root subject, an
        // element with a known iModel ID. If instead it terminated at an element with an external
        // source aspect, we would need its scope to find its iModel ID. But its scope is its iModel
        // ID. So we need its iModel ID to find its iModel ID. That's a dependency self-loop.

        return {
            ...meta,
            classFullName: backend.ExternalSourceAspect.classFullName,
            element: { id: elementId },
            scope: { id: this.put(meta.scope) },
            source: meta.source ? { id: this.put(meta.source) } : undefined,
            identifier: meta.anchor,
        };
    }

    private toAspect<A extends Aspect>(elementId: bentley.Id64String, aspect: A): common.ElementAspectProps
    {
        return {
            ...aspect,
            element: { id: elementId },
        };
    }

    /**
     * @internal
     */
    private mapRelationship<R extends Relationship>(relationship: R, state: RelationshipState): bentley.Id64String
    {
        const props = toRelationship(this, relationship);

        if (state.state === 'update') {
            // This doesn't seem to be working, but more likely it doesn't work as I expected
            // because I didn't think through its implementation properly. The BIS spec says that
            // link-table relationships can contain properties.

            // https://www.itwinjs.org/bis/guide/fundamentals/relationship-fundamentals/#link-table

            // `updateInstance` is probably designed to update those properties and not change the
            // source or target of the relationship in the link table, because then it becomes a
            // different relationship. This is the same problem that `fir` runs into when
            // determining if a relationship has changed in the source file, so it stores a copy of
            // every relationship with provenance so it can locate the stale relationship in the
            // iModel when the source changes.

            // this.imodel.relationships.updateInstance(props);

            this.imodel.relationships.deleteInstance({
                id: state.id,
                classFullName: state.fullClass,
                sourceId: state.source,
                targetId: state.target,
            });
        }

        return this.imodel.relationships.insertInstance(props);
    }

    /**
     * Determines if an element in the source document has changed by comparing its external source
     * aspect to the corresponding one in the iModel. Note that there is no `'new'` member in the
     * {@link Change} type, because we make use of {@link Sync#put} to ensure that the element
     * exists.
     *
     * There is some duplicated work when calling {@link Sync#sync} on a new element, because we
     * know that the element is brand new, but this information is not exposed by {@link Sync#put}.
     * As far as this function is concerned the new element has existed for all eternity. I'm not
     * sure if the simplicity of the {@link Sync#put} interface is worth the wasted iModel query.
     *
     * @internal
     */
    private changed<E extends Element>(element: E): Change
    {
        if (element === 'root subject') {
            return 'unchanged';
        }

        // After put-ting the element in the IModel, we know it is either changed or unchanged.
        this.put(element);

        const meta = element.meta;

        const { elementId, aspectId } = this.meta(element);

        if (elementId === undefined || aspectId === undefined) {
            throw Error('fatal: element was put and must have an aspect; this is a 🐛');
        }

        // This type coercion is on the iTwin API. getAspect does not take a type parameter.
        const aspect = this.imodel.elements.getAspect(aspectId) as backend.ExternalSourceAspect;

        const versionChange = (
            aspect.version !== undefined && meta.version !== undefined
            && aspect.version !== meta.version
        );

        const checksumChange = (
            aspect.checksum !== undefined && meta.checksum !== undefined
            && aspect.checksum !== meta.checksum
        );

        // A version change takes priority over a checksum change.
        if (versionChange || checksumChange) {
            return 'changed';
        }

        return 'unchanged';
    }

    /**
     * Given a subtree of the iModel, delete any elements and models that have not been seen by
     * the synchronizer and whose child elements have not been seen. Note that `fir` uses
     * {@link Sync#put} to find or insert the branch, so the argument will never be deleted.
     *
     * @remarks
     * This code is expected to be replaced by
     * [`ElementTreeDeleter`](https://github.com/iTwin/connector-framework/blob/main/src/ElementTreeWalker.ts)
     * when it is merged into the iTwin libraries. This implementation does not defer the deletion
     * of definition elements; it trades efficiency for correctness, because I don't know how the
     * backend processes different classes of definition elements when `deleteDefinitionElements`
     * is called.
     *
     * @see [Sam Wilson's comments](https://github.com/iTwin/connector-framework/blob/main/src/ElementTreeWalker.ts#L256-L263)
     * if you're interested why this isn't totally trivial.
     *
     * > `deleteDefinitionElements` does not preserve the order that you specify, and it does not
     * > process children before parents.
     *
     * @todo What about deferring definition elements until we encounter a definition model, and
     * then pass its immediate children? How does the backend respond to `DefinitionGroup` and
     * `DefinitionContainer`?
     */
    trim<B extends Element | Model>(branch: B): Trim
    {
        const branchId = this.put(branch);
        return this.trimTree(branchId);
    }

    private trimTree(branch: bentley.Id64String): Trim
    {
        // There are only two kinds of elements in BIS: modeled elements and parent elements.
        // See also: https://www.itwinjs.org/bis/intro/modeling-with-bis/#relationships

        // We perform a post-order traversal down the channel, because we must ensure that every
        // child is deleted before its parent, and every model before its modeled element.

        let children: bentley.Id64String[];

        let deletedElements = 0;
        let deletedModels = 0;
        let deletedAspects = 0;

        const model = this.imodel.models.tryGetSubModel(branch);
        const isElement = model === undefined;

        if (isElement) {
            // The element is a parent element.
            children = childrenOfElement(this.imodel, branch);
        } else {
            // The element is a modeled element.
            children = childrenOfModel(this.imodel, model.id);
        }

        children.forEach((child) => {
            const deleted = this.trimTree(child);
            deletedElements += deleted.deletedElements;
            deletedModels += deleted.deletedModels;
            deletedAspects += deleted.deletedAspects;
        });

        // If all elements were deleted successfully, delete the parent.

        const element = this.imodel.elements.getElement(branch);
        let remainingChildren: bentley.Id64String[];

        if (isElement) {
            remainingChildren = childrenOfElement(this.imodel, branch);
        } else {
            remainingChildren = childrenOfModel(this.imodel, model.id);
        }

        // A category will have an unmanaged default subcategory. If we don't see the category,
        // and its managed subcategories are deleted, we forcibly delete this subcategory.

        const managed = isManaged(this.imodel, branch);
        const seen = this.touched.has(branch);
        const subcategoryWithDefault = element instanceof backend.Category && remainingChildren.length === 1;
        const noChildren = remainingChildren.length === 0 || subcategoryWithDefault;

        if (managed && !seen && noChildren) {
            // console.log(`Visiting element ${branch} :: ${element.classFullName} (proto ${Object.getPrototypeOf(element).constructor.name}); definition? ${element instanceof backend.DefinitionElement}`);

            if (isElement) {
                this.trimRelationship(branch);

                // Note that although ReturnType<backend.getElement> :: backend.Element, the
                // backend does some weird stuff and is able to construct the corresponding
                // *class type* in iTwin's libraries. This means that the element's prototype chain
                // is intact despite its type being narrowed to backend.Element. We can filter the
                // element using instanceof.

                // Aspects are owned, i.e., their lifetime is managed by their owning element. When
                // we delete the element, the aspects are deleted, so we count them in advance
                // before letting the backend loose.

                if (element instanceof backend.DefinitionElement) {
                    // console.log(`Try deleting definition ${element.id} :: ${element.className}; label: ${element.userLabel}`);

                    const aspects = this.imodel.elements.getAspects(branch).length;
                    const inUse = this.imodel.elements.deleteDefinitionElements([branch]).size;

                    if (inUse === 0) {
                        // console.log('  Success!');

                        deletedElements += 1;
                        if (element instanceof backend.Category) {
                            deletedElements += 1; // The default subcategory.
                        }

                        deletedAspects += aspects;
                    }
                } else {
                    // console.log(`Deleting element ${element.id} :: ${element.className}; label: ${element.userLabel}`);

                    deletedElements += 1;
                    deletedAspects += this.imodel.elements.getAspects(branch).length;

                    this.imodel.elements.deleteElement(branch);
                }
            } else {
                // If we've deleted all the immediate children of the model, delete both the modeled
                // element and the model.

                // console.log(`Deleting model ${model.id} :: ${model.className}`);

                deletedElements += 1;
                deletedModels += 1;
                deletedAspects += this.imodel.elements.getAspects(branch).length;

                this.imodel.models.deleteModel(model.id);
                this.imodel.elements.deleteElement(branch);
            }
        }

        return { deletedElements, deletedModels, deletedAspects };
    }

    /**
     * Only elements can be involved in link-table relationships. Because `fir` maintains the
     * provenance information of each link-table relationship in its store, a special repository
     * link, we have to make sure that when a link-table relationship is implicitly deleted we
     * remove that provenance / anchor from the store. This is inefficient however, because it means
     * that every time we delete an element we have to retrieve and parse its JSON properties, which
     * may be massive. The alternative is taking a linear pass over the store and searching for
     * each relationship to see if it exists every time the connector author calls
     * { @link Sync#trim }.
     *
     * @internal
     */
    private trimRelationship(element: bentley.Id64String): void
    {
        const readSource = this.readTag(element);

        if (readSource.success) {
            // For now assume that every tag on an element is a relationship anchor.
            // TODO: This will change when the aspect API allows us to keep track of aspects. Then
            // tags will have to be further namespaced within the 'fir' namespace.

            const source = readSource.payload as { [anchor: string]: null };
            const anchors = Object.keys(source);

            if (anchors.length === 0) {
                // This element had no relationships, we are done.
                return;
            }

            this.cutTag(element, anchors);

            // Now for each link-table relationship that involves this element, locate the related
            // element and remove the anchor for the relationship. Delete the provenance in the
            // store.

            for (const anchor of anchors) {
                const readRelationship = this.readTag(this.store, anchor);

                if (!readRelationship.success) {
                    throw Error('fatal: read relationship anchor in element but not in store; this is a 🐛');
                }

                type Related = { target: string };

                const related = readRelationship.payload as Related;

                this.cutTag(this.store, anchor);
                this.cutTag(related.target, anchor);
            }
        }
    }

    /**
     * Given a `fir` element, fetch its external source aspect from the iModel.
     */
    meta<E extends Element>(element: E): ReturnType<typeof backend.ExternalSourceAspect.findBySource>
    {
        if (element === 'root subject') {
            throw Error('fatal: no external aspect on the root subject 💥');
        }

        const meta = element.meta;
        const scope = this.put(meta.scope);

        return backend.ExternalSourceAspect.findBySource(
            this.imodel,
            scope, meta.kind, meta.anchor
        );
    }

    /**
     * Tag an element with a key-value pair in its JSON properties. If the key already exists, it
     * will be written over.
     */
    private tag<E extends Element>(element: E, key: string, value: unknown): void
    {
        if (element === 'root subject') {
            throw Error('fatal: cannot tag root subject 💥');
        }

        const found = this.imodel.elements.getElementProps(this.put(element));

        let json: Json = found.jsonProperties;

        if (json === undefined) {
            // There are no JSON properties on the element.
            json = { fir: {} };
        } else if (json.fir === undefined) {
            // There are JSON properties, but no 'fir' namespace.
            json.fir = { };
        }

        const fir = json.fir as { [property: string] : unknown };

        fir[key] = value;

        this.imodel.elements.updateElement({
            id: this.put(element),
            model: this.put(element.model),
            code: element.code,
            classFullName: element.classFullName,
            jsonProperties: json,
        });
    }

    /**
     * Remove key-value pair tag from an element' JSON properties. If the key does not exist, this
     * is a nop.
     */
    private cutTag<E extends Element>(element: E | bentley.Id64String, key: string | string[]): void
    {
        if (element === 'root subject') {
            throw Error('fatal: cannot untag root subject 💥');
        }

        const id = typeof element === 'string' && element !== 'root subject' ? element : this.put(element);
        const found = this.imodel.elements.getElementProps(id);

        const json: Json = found.jsonProperties;

        if (json === undefined || json.fir === undefined) {
            // There are no JSON properties on the element or no `fir` namespace.
            return;
        }

        const fir = json.fir as { [property: string] : unknown };

        const staged = typeof key === 'string' ? [ key ] : key;
        staged.forEach(key => delete fir[key]);

        this.imodel.elements.updateElement({
            ...found,
            jsonProperties: json,
        });
    }

    /**
     * Retrieve a tag in `fir`'s namespace. If the tag does not exist, null is returned.
     *
     * @internal
     */
    private readTag<E extends Element>(element: E | bentley.Id64String, key?: string): Read
    {
        if (element === 'root subject') {
            throw Error('fatal: cannot tag root subject 💥');
        }

        const id = typeof element === 'string' && element !== 'root subject' ? element : this.put(element);
        const found = this.imodel.elements.getElementProps(id);

        const json: Json = found.jsonProperties;

        if (!(json && json.fir)) {
            // No JSON properties on this element, or no fir namespace.
            return { success: false };
        }

        const fir = json.fir as { [property: string] : unknown };

        if (key && fir[key] === undefined) {
            return { success: false };
        }

        return { success: true, payload: key ? fir[key] : json.fir };
    }
}

type UserJson = { [property: string]: unknown } | undefined;
type Json = { [namespace: string]: unknown } | undefined;

function mergeJson(user: UserJson, existing: Json): Json
{
    // if (user) {
    //     existing.UserProps = user;
    // } else {
    //     delete existing.UserProps;
    // }

    if (!existing) {
        existing = user;
    } else if (user) {
        Object.assign(existing, user);
    }

    return existing;
}
