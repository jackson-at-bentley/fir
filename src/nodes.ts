/*--------------------------------------------------------------------------------------------------
 * Copyright (c) Bentley Systems, Incorporated. All rights reserved.
 * See LICENSE.md in the project root for license terms and full copyright notice.
 *------------------------------------------------------------------------------------------------*/

import * as common from '@itwin/core-common';

import type { To } from './sync.js';

// --- Nodes ---

export type EntityNode<P extends common.EntityProps> =
    Omit<P, 'id'>;

export type ElementNode<P extends common.ElementProps> =
    Omit<EntityNode<P>, keyof ElementPatch>
        & ElementPatch;

export type ModelNode<P extends common.ModelProps> =
    Omit<EntityNode<P>, keyof ModelPatch>
        & ModelPatch;

export type AspectNode<P extends common.ElementAspectProps> =
    Omit<EntityNode<P>, | 'identifier' | 'element'>

export type ExternalSourceAspectNode =
    Omit<AspectNode<common.ExternalSourceAspectProps>, keyof ExternalSourceAspectPatch>
        & ExternalSourceAspectPatch;

export type ExternalSourceNode<P extends common.ExternalSourceProps> =
    Omit<ElementNode<P>, keyof ExternalSourcePatch>
        & ExternalSourcePatch;

// --- Patches ---

// The second type in the parent property is fir's RelatedElementProps.
// https://www.itwinjs.org/reference/core-common/entities/relatedelementprops v

export type ElementPatch = {
    model: Model,
    parent?: Element | { element: Element, relationship: string }
    meta: Meta,
    aspects?: Aspect[]
    to: To<ElementNode<common.ElementProps>, common.ElementProps>
};

export type ModelPatch = {
    // A model cannot have provenance because it is not an element.
    parentModel?: Model,
    modeledElement: Element,
    to: To<ModelNode<common.ModelProps>, common.ModelProps>,
};

export type ExternalSourceAspectPatch = {
    scope: Element,
    source?: Source,
    anchor: string,
};

export type ExternalSourcePatch = {
    repository?: Repository,
    to: To<ExternalSourceNode<common.ExternalSourceProps>, common.ExternalSourceProps>
};

// --- Exports ---

export type Entity<P extends common.EntityProps = common.EntityProps>
    = EntityNode<P>;

export type Element<P extends common.ElementProps = common.ElementProps>
    = ElementNode<P> | 'root subject';

export type Model<P extends common.ModelProps = common.ModelProps>
    = ModelNode<P> | 'repository';

export type Aspect<P extends common.ElementAspectProps = common.ElementAspectProps>
    = AspectNode<P>;

export type Source<P extends common.ExternalSourceProps = common.ExternalSourceProps>
    = ExternalSourceNode<P>;

export type Repository<P extends common.RepositoryLinkProps = common.RepositoryLinkProps> =
    ElementNode<P>;

export type Meta = ExternalSourceAspectNode;

// Unfinished thoughts and things I don't understand about TypeScript.

// - Support Meta | Meta[], because an element can have more than one source aspect.
// - The element node narrows its parent. There's no type safety there; we can enforce it by
//   overriding the parent type in a child node. For example, the parent of a subcategory cannot be
//   a repository link. There's similar narrowing in other references to elements.
