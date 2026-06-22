import { appClusters, type AppCluster } from "@/components/providers/SolanaProvider";

export function ClusterSelector({ cluster, onClusterChange }: { cluster: AppCluster; onClusterChange: (clusterId: AppCluster["id"]) => void }) {
  return (
    <>
      <label className="sr-only" htmlFor="cluster-select">Cluster</label>
      <select className="rounded-xl border border-white/10 bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-violet-100" id="cluster-select" value={cluster.id} onChange={(event) => onClusterChange(event.target.value as AppCluster["id"])}>
        {appClusters.map((clusterOption) => <option key={clusterOption.id} value={clusterOption.id}>{clusterOption.label}</option>)}
      </select>
    </>
  );
}
