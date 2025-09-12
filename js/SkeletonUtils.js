THREE.SkeletonUtils = {
    clone: function(source) {
        const sourceLookup = new Map();
        const cloneLookup = new Map();
        const clone = source.clone(true);
        parallelTraverse(source, clone, (src, cloned) => {
            sourceLookup.set(cloned, src);
            cloneLookup.set(src, cloned);
        });
        source.traverse(function(src) {
            if (!src.isSkinnedMesh) return;
            const clonedMesh = cloneLookup.get(src);
            const skeleton = src.skeleton;
            const clonedBones = skeleton.bones.map(b => cloneLookup.get(b));
            clonedMesh.bind(new THREE.Skeleton(clonedBones, skeleton.boneInverses), clonedMesh.matrixWorld);
        });
        return clone;
        function parallelTraverse(a, b, callback) {
            callback(a, b);
            for (let i = 0; i < a.children.length; i++) {
                parallelTraverse(a.children[i], b.children[i], callback);
            }
        }
    }
};
