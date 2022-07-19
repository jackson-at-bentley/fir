/*--------------------------------------------------------------------------------------------------
 * Copyright (c) Bentley Systems, Incorporated. All rights reserved.
 * See LICENSE.md in the project root for license terms and full copyright notice.
 *------------------------------------------------------------------------------------------------*/

import * as backend from '@itwin/core-backend';
import * as bentley from '@itwin/core-bentley';
import * as common from '@itwin/core-common';

import { Element, Model, Aspect, Entity, Source, Meta } from './nodes.js';
import { modelOf, childrenOfModel, childrenOfElement } from './queries.js';

/**
 * This type is fed to the mapping functions, like {@link Sync#mapElement}, to let them know how to
 * map a `fir` type to an iTwin 'props' type.
 */
export type State = { state: 'update', id: bentley.Id64String } | { state: 'new' };

/**
 * An element can either be new or changed, because the library relies on {@link Sync#put} to insert
 * an element if it does not exist. This type is returned by {@link Sync#changed}.
 */
export type Change = 'changed' | 'unchanged';

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
            model: sync.putModel(element.model), // The mapped model.
            parent: undefined,                   // TODO: Hack. Prefer no property if no parent.
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
                    id: sync.putElement(parent),
                    relClassName: relationship ?? sync.resolveParentClass(parent),
                };
            }
        }

        return elementProps;
}

export function toSource<S extends Source>(sync: Sync, source: S): common.ExternalSourceProps
{
    const sourceProps: common.ExternalSourceProps = {
        ...toElement(sync, source),
        repository: source.repository ? { id: sync.putElement(source.repository) }: undefined,
    };

    return sourceProps;
}

export function toModel<M extends Model>(sync: Sync, model: M)
{
    if (model === 'repository') {
        throw Error('fatal: cannot form props of repository model 💥');
    }

    const modeledId = sync.putElement(model.modeledElement);

    const modelProps: common.ModelProps = {
        ...model,
        parentModel: model.parentModel ? sync.putModel(model.parentModel) : undefined,
        modeledElement: { id: modeledId },
    };

    return modelProps;
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
    touched: Set<bentley.Id64String> = new Set();

    constructor(imodel: backend.IModelDb)
    {
        this.imodel = imodel;
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
            return this.syncElement(branch);
        }

        // Ditto.

        if ('modeledElement' in branch) {
            return this.syncModel(branch);
        }

        throw Error('fatal: sync narrowing failure; this is a 🐛');
    }

    /**
     * Because we can only attach external source aspects to elements, a model does not have
     * information that anchors it to the source document. In BIS speak, this is _provenance_. Thus,
     * we only update the model if its modeled element has changed.
     *
     * @see Sync#sync
     */
    syncModel<M extends Model>(model: M): void
    {
        if (model === 'repository') {
            return;
        }

        const modelId = this.putModel(model);

        if (this.changed(model.modeledElement) === 'changed') {
            this.mapModel(model, { state: 'update', id: modelId });
        }
    }

    syncElement<E extends Element>(element: E): void
    {
        if (element === 'root subject') {
            return;
        }

        const elementId = this.putElement(element);

        if (this.changed(element) === 'changed') {
            this.mapElement(element, { state: 'update', id: elementId });
        }
    }

    /**
     * Insert `fir`'s representation of a branch in an iModel into the iModel. Its ID is returned.
     * If the branch already exists `fir` will not attempt to insert it again. I like to think of
     * it like the shell program `touch`.
     */
    put<B extends Element | Model>(branch: B): bentley.Id64String
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

        throw Error('fatal: put narrowing failure; this is a 🐛');
    }

    putModel<M extends Model>(model: M): bentley.Id64String
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

    putElement<E extends Element>(element: E): bentley.Id64String
    {
        // TODO: Detect and report scope loops.

        // Put a single element in the iModel. Its dependencies must be inserted:
        // - All parents of the element, up to the root subject
        // - The external source aspects of the element, and their external sources and repositories

        if (element === 'root subject') {
            return common.IModel.rootSubjectId;
        }

        let { elementId } = this.getExternalAspect(element);

        if (!elementId) {
            // The element does not exist in the iModel. Map the intermediate representation to
            // props.
            elementId = this.mapElement(element, { state: 'new' });
        }

        this.touched.add(elementId);
        return elementId;
    }

    /**
     * Map `fir`'s representation of a model to its iTwin 'props' type. The {@link State} type is
     * required because the iTwin libraries require an ID for an update operation. The mapping
     * functions aren't responsible for providing that ID; that's {@link Sync#sync}'s job.
     */
    mapModel<M extends Model>(model: M, state: State): bentley.Id64String
    {
        if (model === 'repository') {
            return common.IModel.repositoryModelId;
        }

        const modelProps = model.to(this, model);

        let modelId: bentley.Id64String;

        if (state.state === 'update') {
            modelId = modelProps.id = state.id;
            this.imodel.models.updateModel(modelProps);
        } else {
            modelId = this.imodel.models.insertModel(modelProps);
        }

        return modelId;
    }

    mapElement<E extends Element>(element: E, state: State): bentley.Id64String
    {
        if (element === 'root subject') {
            return common.IModel.rootSubjectId;
        }

        const elementProps = element.to(this, element);

        let elementId: bentley.Id64String;

        if (state.state === 'update') {
            elementId = elementProps.id = state.id;
            this.imodel.elements.updateElement(elementProps);
        } else {
            elementId = this.imodel.elements.insertElement(elementProps);
        }

        const meta = element.meta;

        const externalAspectProps = this.mapExternalAspect(elementId, meta);

        if (state.state === 'update') {
            // Bypass the aspect API; currently no way to obtain the ID of an aspect.
            const { aspectId } = this.getExternalAspect(element);
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
            const aspectProps = this.mapAspect(elementId, aspect);
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
     * to supply the ID of the owning element. This is a reasonable restriction unless you want
     * to relate aspects for some reason. Because all BIS relationships must inherit from those in
     * the core, and at the time of writing none relate aspects, we're okay.
     *
     * [Here's my source](https://www.itwinjs.org/bis/intro/relationship-fundamentals/#introduction)
     * for that last statement, straight from Casey.
     */
    mapExternalAspect(elementId: bentley.Id64String, meta: Meta): common.ExternalSourceAspectProps
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
            scope: { id: this.putElement(meta.scope) },
            source: meta.source ? { id: this.putElement(meta.source) } : undefined,
            identifier: meta.anchor,
        };
    }

    mapAspect<A extends Aspect>(elementId: bentley.Id64String, aspect: A): common.ElementAspectProps
    {
        return {
            ...aspect,
            element: { id: elementId },
        };
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
     */
    changed<E extends Element>(element: E): Change
    {
        if (element === 'root subject') {
            return 'unchanged';
        }

        // After put-ting the element in the IModel, we know it is either changed or unchanged.
        this.putElement(element);

        const meta = element.meta;

        const { elementId, aspectId } = this.getExternalAspect(element);

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
    resolveParentClass<E extends Element>(parent: E): string
    {
        // Attempt to infer the class of the parent.

        if (parent === 'root subject') {
            // TODO: The only children of the root subject are partition elements?
            return backend.SubjectOwnsPartitionElements.classFullName;
        }

        return backend.ElementOwnsChildElements.classFullName;
    }

    /**
     * Given a subtree of the iModel, delete any elements and models that have not been seen by
     * the synchronizer and whose child elements have not been seen.
     */
    trim<B extends Element | Model>(branch: B): common.IModelStatus
    {
        const branchId = this.put(branch);
        return this.trimTree(branchId);
    }

    trimTree(branch: bentley.Id64String): common.IModelStatus
    {
        // There are only two kinds of elements in BIS: modeled elements and parent elements.
        // See also: https://www.itwinjs.org/bis/intro/modeling-with-bis/#relationships

        // We perform a post-order traversal down the channel, because we must ensure that every
        // child is deleted before its parent, and every model before its modeled element.

        let children: bentley.Id64String[];
        let childrenStatus = common.IModelStatus.Success;

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
            childrenStatus = foldStatus(childrenStatus, this.trimTree(child));
        });

        // If all elements were deleted successfully, delete the parent.

        // TODO: This if statement throws. We can't recover from this, so we let it explode the
        // process. Can this leave the iModel in an inconsistent state?

        if (childrenStatus === common.IModelStatus.Success) {
            let remainingChildren: bentley.Id64String[];

            if (isElement) {
                remainingChildren = childrenOfElement(this.imodel, branch);
            } else {
                remainingChildren = childrenOfModel(this.imodel, model.id);
            }

            if (isElement && remainingChildren.length === 0 && !this.touched.has(branch)) {
                const element = this.imodel.elements.getElement(branch);
                if (element instanceof backend.DefinitionElement) {
                    // TODO: This is inefficient, but I'm trying to avoid prematurely optimizing. If
                    // we need to, we can locate the youngest common ancestor of the definition
                    // elements seen in a definition model and pass the parent.
                    this.imodel.elements.deleteDefinitionElements([branch]);
                } else {
                    this.imodel.elements.deleteElement(branch);
                }
            } else if (!isElement && remainingChildren.length === 0) {
                // If we've deleted all the immediate children of the model, delete both the modeled
                // element and the model.

                // TODO: Should we ignore the dictionary model because we can't delete it? This will
                // explode, just like deleting the repository model.

                this.imodel.models.deleteModel(model.id);
                this.imodel.elements.deleteElement(branch);
            }
        }

        return common.IModelStatus.Success;
    }

    /**
     * Given a `fir` element, fetch its external source aspect from the iModel.
     */
    getExternalAspect<E extends Element>(element: E): ReturnType<typeof backend.ExternalSourceAspect.findBySource>
    {
        if (element === 'root subject') {
            throw Error('fatal: no external aspect on the root subject 💥');
        }

        const meta = element.meta;
        const scope = this.putElement(meta.scope);

        return backend.ExternalSourceAspect.findBySource(
            this.imodel,
            scope, meta.kind, meta.anchor
        );
    }
}

function foldStatus(folded: common.IModelStatus, addition: common.IModelStatus): common.IModelStatus
{
    if (folded !== common.IModelStatus.Success) {
        return folded;
    }

    return addition;
}
