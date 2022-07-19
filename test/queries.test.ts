import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

import 'mocha';
import { assert } from 'chai';

import * as backend from '@itwin/core-backend';
import * as bentley from '@itwin/core-bentley';
import * as common from '@itwin/core-common';

import { modelOf } from '../src/queries.js';

describe('queries', () => {
    const name = 'my-first-imodel';
    const root = path.dirname(url.fileURLToPath(import.meta.url));
    const outputPath = path.join(root, '..', 'side-effects');
    const imodelPath = path.join(outputPath, `${name}.bim`);
    let imodel: backend.SnapshotDb;

    before(async () => {
        const configuration = new backend.IModelHostConfiguration();
        configuration.cacheDir = outputPath;
        await backend.IModelHost.startup(configuration);
    });

    after(async () => {
        await backend.IModelHost.shutdown();
    });

    beforeEach(() => {
        console.log(imodelPath);
        imodel = backend.SnapshotDb.createEmpty(imodelPath, {
            name,
            rootSubject: { name: 'root' }
        });
    });

    afterEach(() => {
        imodel.close();
        fs.rmSync(imodelPath, { maxRetries: 2, retryDelay: 2 * 1000 });
    });

    // We're using the old API to make sure this query works.
    const partition = () => ({
        classFullName: backend.LinkPartition.classFullName,
        description: 'models my repository links',
        code: common.Code.createEmpty(),
        model: common.IModel.repositoryModelId,
        parent: new backend.SubjectOwnsPartitionElements(common.IModel.rootSubjectId),
    });

    const model = (partitionId: bentley.Id64String) => ({
        classFullName: backend.LinkModel.classFullName,
        name: 'links',
        parentModel: backend.IModelDb.repositoryModelId,
        modeledElement: { id: partitionId },
    });

    it('query of model is null when model does not exist', () => {
        const partitionId = imodel.elements.insertElement(partition());
        assert.strictEqual(modelOf(imodel, partitionId), null);
    });

    it('query of model succeeds when model exists', () => {
        const partitionId = imodel.elements.insertElement(partition());
        const modelId = imodel.models.insertModel(model(partitionId));
        assert.strictEqual(modelOf(imodel, partitionId), modelId);
    });
});
