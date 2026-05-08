# Repository Rules

## Local container registry

- The canonical in-cluster image repository is `registry.infra-tools.svc.cluster.local:5000/cicd-challenge`.
- Kubernetes deployment manifests and GitOps image updates must keep using that in-cluster reference for deploys.
- Do not switch deploy manifests back to the GitLab registry or the old `registry.local.svc.cluster.local` hostname.
- If CI runs outside k3s, Kaniko may push through `PUSH_REGISTRY_IMAGE`, but that alias must point to the same registry backend as `registry.infra-tools.svc.cluster.local:5000/cicd-challenge`.
- Example deploy tag: `registry.infra-tools.svc.cluster.local:5000/cicd-challenge:abc123`.
