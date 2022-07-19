/*--------------------------------------------------------------------------------------------------
 * Copyright (c) Bentley Systems, Incorporated. All rights reserved.
 * See LICENSE.md in the project root for license terms and full copyright notice.
 *------------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

import * as backend from '@itwin/core-backend';
import * as common from '@itwin/core-common';
import * as geometry from '@itwin/core-geometry';

import { Element, Model, Meta, Source, Repository } from '../src/nodes.js';
import { Sync, toElement, toModel, toSource } from '../src/sync.js';

import * as elements from './test-connector-elements.js';
import * as models from './test-connector-models.js';
import * as parts from './test-connector-geometry.js';

// For integration testing.

type TestPayload = {
    updateTile?: {
        anchor: string,
        version: string,
        userLabel: string,
        condition: string,
    }
} | null;

// The test connector in @itwin/connector-framework but written in fir.

function meta<E extends Element>(anchor: string, version: string, scope: E, source?: Source): Meta
{
    return {
        classFullName: backend.ExternalSourceAspect.classFullName,
        scope,
        source,
        anchor,
        kind: 'json',
        version,
    };
}

function groupModel(fir: Sync, repository: Repository, source: Source): Model
{
    const groupPartition: Element<common.InformationPartitionElementProps> = {
        classFullName: backend.GroupInformationPartition.classFullName,
        code: backend.GroupInformationPartition.createCode(
            fir.imodel, common.IModel.rootSubjectId, 'Groups'
        ),
        model: 'repository',
        parent: 'root subject',
        meta: meta('Groups', '1.0.0', repository, source),
        description: 'The modeled element of the group model!',
        to: toElement,
    };

    fir.sync(groupPartition);

    const groupModel: Model = {
        classFullName: models.TestConnectorGroupModel.classFullName,
        parentModel: 'repository',
        modeledElement: groupPartition,
        to: toModel,
    };

    // We don't use a BisCore:ElementHasLinks from the model to the repository because the source
    // of the relationship is an element, not a model. I'm not sure what the original test connector
    // intended.

    fir.sync(groupModel);

    return groupModel;
}

function physicalModel(fir: Sync, repository: Repository, source: Source): Model
{
    const physicalPartition: Element<common.InformationPartitionElementProps> = {
        classFullName: backend.PhysicalPartition.classFullName,
        code: backend.GroupInformationPartition.createCode(
            fir.imodel, common.IModel.rootSubjectId, 'Physical'
        ),
        model: 'repository',
        parent: 'root subject',
        meta: meta('Physical', '1.0.0', repository, source),
        description: 'The modeled element of the physical model!',
        to: toElement,
    };

    fir.sync(physicalPartition);

    const physicalModel: Model = {
        classFullName: backend.PhysicalModel.classFullName,
        parentModel: 'repository',
        modeledElement: physicalPartition,
        to: toModel,
    };

    fir.sync(physicalModel);

    return physicalModel;
}

function definitionModel(fir: Sync, repository: Repository, source: Source): Model
{
    const definitionPartition: Element<common.InformationPartitionElementProps> = {
        classFullName: backend.DefinitionPartition.classFullName,
        code: backend.DefinitionPartition.createCode(
            fir.imodel, common.IModel.rootSubjectId, 'Definitions'
        ),
        model: 'repository',
        parent: 'root subject',
        meta: meta('Definitions', '1.0.0', repository, source),
        description: 'The modeled element of the definition model!',
        to: toElement,
    };

    fir.sync(definitionPartition);

    const definitionModel: Model = {
        classFullName: backend.DefinitionModel.classFullName,
        parentModel: 'repository',
        modeledElement: definitionPartition,
        to: toModel,
    };

    fir.sync(definitionModel);

    return definitionModel;
}

function rootCategory(fir: Sync, definitionModel: Model, repository: Repository, source: Source): Element<common.CategoryProps>
{
    const category = backend.SpatialCategory.create(
        fir.imodel, fir.put(definitionModel), 'TestConnector'
    );

    const props: Element<common.CategoryProps> = {
        ...category.toJSON(),
        model: definitionModel,
        parent: undefined,
        meta: meta('Category', '1.0.0', repository, source),
        description: "I don't know what this root category is for yet.",
        rank: common.Rank.Application,
        to: toElement,
    };

    fir.sync(props);

    // TODO: The original connector should not be calling SpatialCategory.insert because it bypasses
    // the synchronizer. This is why the categories are deleted at the end of the pass, and the
    // definition model. We need an alternative to setDefaultAppearance. Maybe this requires a new
    // Node type with a hook to make things easier.

    // https://www.itwinjs.org/reference/core-backend/categories/category/#setdefaultappearance

    const categoryId = fir.put(props);

    const inflatedCategory = fir.imodel.elements.getElement<backend.SpatialCategory>(categoryId);

    const subcategoryAppearance: common.SubCategoryAppearance.Props = {
        color: common.ColorByName.white,
    };

    inflatedCategory.setDefaultAppearance(subcategoryAppearance);

    return props;
}

function subcategory(
    fir: Sync,
    name: string, color: number, parentCategory: Element<common.CategoryProps>, definitionModel: Model,
    repository: Repository, source: Source): void
{
    const appearance: common.SubCategoryAppearance.Props = {
        color,
    };

    fir.sync<Element<common.SubCategoryProps>>({
        classFullName: backend.SubCategory.classFullName,
        code: backend.SubCategory.createCode(
            fir.imodel, fir.put(parentCategory), name
        ),
        model: definitionModel,
        parent: {
            element: parentCategory,
            relationship: backend.CategoryOwnsSubCategories.classFullName
        },
        meta: meta(name, '1.0.0', repository, source),
        description: "I'm a happy subcategory.",
        appearance,
        to: toElement,
    });
}

function renderMaterial(
    fir: Sync,
    name: string, definitionModel: Model, params: backend.RenderMaterialElement.Params,
    repository: Repository, source: Source,
): void
{
    const material = backend.RenderMaterialElement.create(
        fir.imodel,
        fir.put(definitionModel),
        name,
        params
    );

    fir.sync<Element<common.RenderMaterialProps>>({
        ...material.toJSON(),
        model: definitionModel,
        parent: undefined,
        meta: meta(name, '1.0.0', repository, source),
        to: toElement,
    });
}

function coloredPlasticParams(): backend.RenderMaterialElement.Params {
    const params = new backend.RenderMaterialElement.Params('Palette');
    params.transmit = 0.5;
    return params;
}

function magnetizedFerriteParams(): backend.RenderMaterialElement.Params {
    const params = new backend.RenderMaterialElement.Params('Palette');
    const darkGrey = toRgbFactor(common.ColorByName.darkGrey);
    params.specularColor = darkGrey;
    params.color = darkGrey;
    return params;
}

function toRgbFactor(color: number): number[] {
    const numbers = common.ColorDef.getColors(color);
    const factor: number[] = [ numbers.r, numbers.g, numbers.b, ];
    return factor;
}

function defineGeometry(
    fir: Sync,
    name: string, primitive: geometry.SolidPrimitive, definitionModel: Model,
    repository: Repository, source: Source
): void
{
    const builder = new common.GeometryStreamBuilder();
    builder.appendGeometry(primitive);

    const modelId = fir.put(definitionModel);

    const geometry: Element<common.GeometryPartProps> = {
        classFullName: backend.GeometryPart.classFullName,
        code: backend.GeometryPart.createCode(fir.imodel, modelId, name),
        model: definitionModel,
        meta: meta(name, '1.0.0', repository, source),
        to: toElement,
        geom: builder.geometryStream,
    };

    fir.sync(geometry);
}

function defineParts(
    fir: Sync,
    definitionModel: Model, repository: Repository, source: Source
): void
{
    defineBox      (fir, definitionModel, new parts.SmallSquareCasing()        , repository, source);
    defineBox      (fir, definitionModel, new parts.LargeSquareCasing()        , repository, source);
    defineBox      (fir, definitionModel, new parts.RectangleCasing()          , repository, source);
    defineTriangle (fir, definitionModel, new parts.EquilateralTriangleCasing(), repository, source);
    defineTriangle (fir, definitionModel, new parts.IsoscelesTriangleCasing()  , repository, source);
    defineTriangle (fir, definitionModel, new parts.RightTriangleCasing()      , repository, source);
    defineBox      (fir, definitionModel, new parts.RectangularMagnetCasing()  , repository, source);
    defineMagnet   (fir, definitionModel                                       , repository, source);
  }

function defineBox(
    fir: Sync,
    definitionModel: Model, casing: parts.QuadCasing,
    repository: Repository, source: Source
): void {
    const center     = casing.center();
    const size       = casing.size();
    const vectorX    = geometry.Vector3d.unitX();
    const vectorY    = geometry.Vector3d.unitY();
    const baseX      = size.x;
    const baseY      = size.y;
    const topX       = size.x;
    const topY       = size.y;
    const halfHeight = size.z / 2;

    const baseCenter = new geometry.Point3d(center.x, center.y, center.z - halfHeight);
    const topCenter  = new geometry.Point3d(center.x, center.y, center.z + halfHeight);

    let baseOrigin   = fromSumOf(baseCenter, vectorX, baseX * -0.5);
    baseOrigin       = fromSumOf(baseOrigin, vectorY, baseY * -0.5);

    let topOrigin    = fromSumOf(topCenter, vectorX, baseX * -0.5);
    topOrigin        = fromSumOf(topOrigin, vectorY, baseY * -0.5);

    const box = geometry.Box.createDgnBox(
        baseOrigin, vectorX, vectorY, topOrigin, baseX, baseY, topX, topY, true
    );

    if (undefined === box) {
        throw new common.IModelError(
            common.IModelStatus.NoGeometry, `fatal: unable to create geometry for ${casing.name()}`
        );
    }

    defineGeometry(fir, casing.name(), box, definitionModel, repository, source);
}

function fromSumOf(p: geometry.Point3d, v: geometry.Vector3d, scale: number): geometry.Point3d {
    const result = new geometry.Point3d();
    result.x = p.x + v.x * scale;
    result.y = p.y + v.y * scale;
    result.z = p.z + v.z * scale;
    return result;
}

function defineTriangle(
    fir: Sync,
    definitionModel: Model, casing: parts.TriangleCasing,
    repository: Repository, source: Source
): void
{
    const loop = geometry.Loop.createPolygon(casing.points());
    const sweep = geometry.LinearSweep.create(loop, casing.vec(), true);

    if (undefined === sweep) {
        throw new common.IModelError(
            common.IModelStatus.NoGeometry, `fatal: unable to create geometry for ${casing.name()}`
        );
    }

    defineGeometry(fir, casing.name(), sweep, definitionModel, repository, source);
}

function defineMagnet(fir: Sync, definitionModel: Model, repository: Repository, source: Source): void {
    const radius     = parts.Casings.MagnetRadius;
    const baseCenter = new geometry.Point3d(0.0, 0.0, -parts.Casings.MagnetThickness / 2);
    const topCenter  = new geometry.Point3d(0.0, 0.0,  parts.Casings.MagnetThickness / 2);
    const cone       = geometry.Cone.createAxisPoints(baseCenter, topCenter, radius, radius, true);
    const name       = elements.GeometryParts.CircularMagnet;

    if (undefined === cone) {
        throw new common.IModelError(
            common.IModelStatus.NoGeometry, `fatal: unable to create geometry for ${name}`
        );
    }

    defineGeometry(fir, name, cone, definitionModel, repository, source);
}

function read(): { [property: string]: unknown }
{
    // TODO: I really don't know how to handle JSON properly in TypeScript.
    const root = path.dirname(url.fileURLToPath(import.meta.url));
    const json = path.join(root, 'assets', 'test-connector.json');
    return JSON.parse(fs.readFileSync(json, { encoding: "utf8" }));
}

function syncGroups(fir: Sync, groupModel: Model, repository: Repository, source: Source): void
{
    const json = read();

    if (!('Groups' in json && Array.isArray(json.Groups))) {
        throw Error("fatal: expect property 'Groups' in source file");
    }

    // TODO: isArray performs unsafe conversion to any. That's why I get away with this bind. Don't
    // know what Groups is an array *of*.
    const groups: { [property: string]: string | undefined }[] = json.Groups;

    for(const group of groups) {
        if (!(group.guid && group.name)) {
            throw Error("fatal: expect property 'guid' and 'name' in group");
        }

        fir.sync<Element<elements.TestConnectorGroupProps>>({
            classFullName: elements.TestConnectorGroup.classFullName,
            code: elements.TestConnectorGroup.createCode(
                fir.imodel, fir.put(groupModel), group.name
            ),
            model: groupModel,
            meta: meta(group.guid, '1.0.0', repository, source),
            to: toElement,
            groupType: group.groupType,
            manufactureLocation: group.manufactureLocation,
            manufactureDate: group.manufactureDate ? new Date(group.manufactureDate) : undefined,
        });
    }
}

function syncShapes(
    fir: Sync,
    physicalModel: Model, definitionModel: Model, groupModel: Model,
    repository: Repository, source: Source,
    payload: TestPayload
): void
{
    const json = read();

    if (!('Tiles' in json && typeof json.Tiles === 'object' && json.Tiles !== null)) {
        throw Error("fatal: expect property 'Tiles' in source file");
    }

    for (const [kind, shapes] of Object.entries(json.Tiles)) {
        if (Array.isArray(shapes)) {
            for (const shape of shapes) {
                syncShape(
                    fir,
                    kind, shape,
                    physicalModel, definitionModel, groupModel,
                    repository, source,
                    payload,
                );
            }
        } else if (typeof shapes === 'object' && shapes !== null) {
            syncShape(
                fir,
                kind, shapes,
                physicalModel, definitionModel, groupModel,
                repository, source,
                payload,
            );
        } else {
            throw Error("fatal: expect 'Tiles' values to be object or list of objects");
        }
    }
}

function syncShape(
    fir: Sync,
    kind: string, shape: { [property: string]: string | undefined },
    physicalModel: Model, definitionModel: Model, groupModel: Model,
    repository: Repository, source: Source,
    payload: TestPayload,
): void
{
    const physicalModelId = fir.put(physicalModel);
    const definitionModelId = fir.put(definitionModel);
    const groupModelId = fir.put(groupModel);

    let element: backend.PhysicalElement;
    switch (kind) {
        case 'SmallSquareTile':
            element = elements.SmallSquareTile.create(
                fir.imodel, physicalModelId, definitionModelId, shape
            ); break;
        case 'LargeSquareTile':
            element = elements.LargeSquareTile.create(
                fir.imodel, physicalModelId, definitionModelId, shape
            ); break;
        case 'IsoscelesTriangleTile':
            element = elements.IsoscelesTriangleTile.create(
                fir.imodel, physicalModelId, definitionModelId, shape
            ); break;
        case 'EquilateralTriangleTile':
            element = elements.EquilateralTriangleTile.create(
                fir.imodel, physicalModelId, definitionModelId, shape
            ); break;
        case 'RightTriangleTile':
            element = elements.RightTriangleTile.create(
                fir.imodel, physicalModelId, definitionModelId, shape
            ); break;
        case 'RectangleTile':
            element = elements.RectangleTile.create(
                fir.imodel, physicalModelId, definitionModelId, shape
            ); break;
        default:
            throw Error(`fatal: unknown tile shape '${kind}'`);
    }

    if (!shape.guid) {
        throw Error("fatal: expect property 'guid' in shape");
    }

    const version = (
        payload && payload.updateTile && payload.updateTile.anchor === shape.guid
        ? payload.updateTile.version
        : '1.0.0'
    );

    const props: Element<elements.TestConnectorPhysicalProps> = {
        ...element.toJSON(),
        model: physicalModel,
        parent: undefined, // <- Overwrite parent from spread, which isn't compatible with props.
        meta: meta(shape.guid, version, repository, source),
        to: toElement,
    };

    // This is for testing. Normally you'd do the update up there in the object type. ^^

    if (payload && payload.updateTile) {
        if (payload.updateTile.anchor === shape.guid) {
            props.userLabel = payload.updateTile.userLabel;
            props.condition = payload.updateTile.condition;
        }
    }

    // TODO: fir.sync should probably return the ID of the synced element. Unless I want to enforce
    // that the only way to obtain an ID is by 'touching' an element, just like the command-line
    // program.

    fir.sync(props);

    if (shape.Group) {
        const code = elements.TestConnectorGroup.createCode(
            fir.imodel, groupModelId, shape.Group
        );

        const sourceId = fir.imodel.elements.queryElementIdByCode(code);

        if (!sourceId) {
            throw Error(`fatal: group with code value '${code.value}' does not exist`);
        }

        const targetId = fir.put(props);

        // FILE ISSUE: Why doesn't tryGetInstance take RelationshipProps when insert does?

        const arrow = fir.imodel.relationships.tryGetInstance<backend.ElementGroupsMembers>(
            backend.ElementGroupsMembers.classFullName,
            { sourceId, targetId }
        );

        if (!arrow) {
            fir.imodel.relationships.insertInstance({
                classFullName: backend.ElementGroupsMembers.classFullName,
                sourceId, targetId
            });
        }
    }
}

function codeSpecs(fir: Sync): void
{
    // The CodeSpec for ExternalSource elements is not automatically created, so this method ensures
    // that it exists.
    backend.ExternalSource.ensureCodeSpec(fir.imodel); // ?!?

    if (!fir.imodel.codeSpecs.hasName(elements.CodeSpecs.Group)) {
        const spec = common.CodeSpec.create(
            fir.imodel, elements.CodeSpecs.Group, common.CodeScopeSpec.Type.Model
        );

        fir.imodel.codeSpecs.insert(spec);
    }
}

function viewDefinition(
    fir: Sync,
    name: string,
    defaultCategory: Element<common.CategoryProps>,
    physicalModel: Model, definitionModel: Model
): Element<common.SpatialViewDefinitionProps> {
    const cs = categorySelector(fir, defaultCategory, definitionModel);
    const ms = modelSelector(fir, physicalModel, definitionModel);
    const ds = displayStyle(fir, definitionModel);

    const view = backend.OrthographicViewDefinition.create(
        fir.imodel,
        fir.put(definitionModel), name,
        fir.put(ms), fir.put(cs), fir.put(ds),
        fir.imodel.projectExtents,
        geometry.StandardViewIndex.Iso
    );

    const props: Element<common.SpatialViewDefinitionProps> = {
        ...view.toJSON(),
        model: definitionModel,
        parent: undefined, // <- Starting to become a common fir pattern: the toJSON() patten.
        meta: meta('default-view', '1.0.0', 'root subject'),
        to: toElement,
    };

    fir.sync(props);

    return props;
}

function categorySelector(
    fir: Sync,
    category: Element<common.CategoryProps>, definitionModel: Model
): Element<common.CategorySelectorProps>
{
    const categoryId = fir.put(category);

    const selector = backend.CategorySelector.create(
        fir.imodel, fir.put(definitionModel), "Default", [ categoryId ]
    );

    const props: Element<common.CategorySelectorProps> = {
        ...selector.toJSON(),
        model: definitionModel,
        parent: undefined,
        meta: meta('default-category-selector', '1.0.0', 'root subject'),
        to: toElement,
    };

    fir.sync(props);

    return props;
}

function modelSelector(
    fir: Sync,
    physicalModel: Model, definitionModel: Model
): Element<common.ModelSelectorProps>
{
    const selector = backend.ModelSelector.create(
        fir.imodel, fir.put(definitionModel), "Default", [ fir.put(physicalModel) ]
    );

    const props: Element<common.ModelSelectorProps> = {
        ...selector.toJSON(),
        model: definitionModel,
        parent: undefined,
        meta: meta('default-model-selector', '1.0.0', 'root subject'),
        to: toElement,
    };

    fir.sync(props);

    return props;
}

function displayStyle(fir: Sync, definitionModel: Model): Element<common.DisplayStyle3dProps>
{
    const viewFlags = new common.ViewFlags({
        renderMode: common.RenderMode.SmoothShade
    });

    const options: backend.DisplayStyleCreationOptions = {
        backgroundColor: common.ColorDef.fromTbgr(common.ColorByName.white),
        viewFlags,
    };

    const displayStyle = backend.DisplayStyle3d.create(
        fir.imodel, fir.put(definitionModel), "Default", options
    );

    // TODO: Should really scope this display style to the definition partition, because models
    // cannot scope codes.

    const props: Element<common.DisplayStyle3dProps> = {
        ...displayStyle.toJSON(),
        model: definitionModel,
        meta: meta('default-display-style', '1.0.0', 'root subject'),
        parent: undefined,
        to: toElement,
    };

    fir.sync(props);

    return props;
}

export function grow(imodel: backend.IModelDb, payload: TestPayload): void
{
    const fir = new Sync(imodel);

    codeSpecs(fir);

    const repository: Repository = {
        classFullName: backend.RepositoryLink.classFullName,
        code: backend.RepositoryLink.createCode(fir.imodel, common.IModel.rootSubjectId, 'Repository'),
        model: 'repository',
        meta: meta('Repository', '1.0.0', 'root subject'),
        to: toElement,
    };

    fir.sync(repository);

    const source: Source = {
        classFullName: backend.ExternalSource.classFullName,
        code: backend.ExternalSource.createCode(fir.imodel, 'Source'),
        model: 'repository',
        meta: meta('Source', '1.0.0', 'root subject'),
        repository,
        connectorName: 'TestConnector',
        connectorVersion: '1.0.0',
        to: toSource,
    };

    fir.sync(source);

    const groups = groupModel(fir, repository, source);
    const physicals = physicalModel(fir, repository, source);
    const definitions = definitionModel(fir, repository, source);

    const category = rootCategory(fir, definitions, repository, source);

    subcategory(
        fir,
        'Casing', common.ColorByName.white, category, definitions,
        repository, source
    );

    subcategory(
        fir,
        'Magnet', common.ColorByName.darkGrey, category, definitions,
        repository, source
    );

    renderMaterial(
        fir,
        'ColoredPlastic', definitions, coloredPlasticParams(),
        repository, source
    );

    renderMaterial(
        fir,
        'MagnetizedFerrite', definitions, magnetizedFerriteParams(),
        repository, source
    );

    defineParts(fir, definitions, repository, source);

    syncGroups(fir, groups, repository, source);

    syncShapes(fir, physicals, definitions, groups, repository, source, payload);

    const view = viewDefinition(fir, 'TestConnectorView', category, physicals, definitions);

    fir.imodel.views.setDefaultViewId(fir.put(view));

    // Don't forget to clean up!
    fir.trim(physicals);
    fir.trim(definitions);
    fir.trim(groups);

    // All done syncing!
    return;
}
