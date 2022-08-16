import 'mocha';

import * as backend from '@itwin/core-backend';
import * as common from '@itwin/core-common';

import type {
    Element,
    Model
} from '../src/nodes.js';

import {
    Sync,
    toElement,
    toModel
} from '../src/sync.js';

type NestedDefinitionModels = {
  subject: Element<common.SubjectProps>,
}

export function nestedDefinitionModels(fir: Sync): NestedDefinitionModels {
    //                 o - subject
    //                 |
    //                 o - partition
    //                 |
    //                 o - model
    //                 |
    //                 o - definition container
    //                / \
    //    category - o   o - definition container
    //               |   |
    //       ditto - o   o - nested definition model
    //                   |
    //                   o - category
    //                   |
    //                   o - default subcategory

    const imodel = fir.imodel;

    const subject: Element<common.SubjectProps> = {
        classFullName: backend.Subject.classFullName,
        code: common.Code.createEmpty(),
        model: 'repository',
        parent: 'root subject',
        meta: {
            classFullName: backend.ExternalSourceAspect.classFullName,
            scope: 'root subject',
            kind: 'json',
            anchor: 'subject',
            version: '1.0.0',
        },
        to: toElement,
    };

    fir.put(subject);

    const partition: Element<common.InformationPartitionElementProps> = {
        classFullName: backend.DefinitionPartition.classFullName,
        code: common.Code.createEmpty(),
        model: 'repository',
        parent: {
            element: subject,
            relationship: backend.SubjectOwnsPartitionElements.classFullName
        },
        meta: {
            classFullName: backend.ExternalSourceAspect.classFullName,
            scope: subject,
            kind: 'json',
            version: '1.0.0',
            anchor: 'partition',
        },
        to: toElement,
    };

    fir.sync(partition);

    const model: Model<common.ModelProps> = {
        classFullName: backend.DefinitionModel.classFullName,
        modeledElement: partition,
        parentModel: 'repository',
        to: toModel,
    };

    fir.sync(model);

    const containerSpec = common.CodeSpec.create(
        imodel,
        'bis:DefinitionContainer',
        common.CodeScopeSpec.Type.Model
    );

    const rootContainer: Element<common.DefinitionElementProps> = {
        ...backend.DefinitionContainer.create(
            imodel,
            fir.put(model),
            new common.Code({scope: fir.put(model), spec: containerSpec.id, value: 'root container'}),
        ).toJSON(),
        model,
        parent: undefined,
        meta: {
            classFullName: backend.ExternalSource.classFullName,
            scope: partition,
            kind: 'json',
            version: '1.0.0',
            anchor: 'root container',
        },
        to: toElement,
    };

    fir.sync(rootContainer);

    const firstCategory: Element<common.CategoryProps> = {
        classFullName: backend.SpatialCategory.classFullName,
        code: backend.SpatialCategory.createCode(imodel, fir.put(model), 'first category'),
        model,
        parent: rootContainer,
        meta: {
            classFullName: backend.ExternalSourceAspect.classFullName,
            scope: rootContainer,
            kind: 'json',
            version: '1.0.0',
            anchor: 'first category',
        },
        to: toElement,
    };

    fir.sync(firstCategory);

    const childContainer: Element<common.DefinitionElementProps> = {
        ...backend.DefinitionContainer.create(
            imodel,
            fir.put(model),
            new common.Code({scope: fir.put(model), spec: containerSpec.id, value: 'child container'}),
        ).toJSON(),
        model: model,
        parent: undefined,
        meta: {
            classFullName: backend.ExternalSourceAspect.classFullName,
            scope: rootContainer,
            kind: 'json',
            version: '1.0.0',
            anchor: 'child container',
        },
        to: toElement,
    };

    fir.sync(childContainer);

    const nestedModel: Model<common.ModelProps> = {
        classFullName: backend.DefinitionModel.classFullName,
        modeledElement: childContainer,
        parentModel: model,
        to: toModel,
    };

    fir.sync(nestedModel);

    const childCategory: Element<common.CategoryProps> = {
        classFullName: backend.SpatialCategory.classFullName,
        code: backend.SpatialCategory.createCode(imodel, fir.put(model), 'second category'),
        model: nestedModel,
        meta: {
            classFullName: backend.ExternalSourceAspect.classFullName,
            scope: childContainer,
            kind: 'json',
            version: '1.0.0',
            anchor: 'second category',
        },
        to: toElement,
    };

    fir.sync(childCategory);

    return { subject };
}
