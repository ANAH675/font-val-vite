import { useEffect, useMemo, useState, useCallback } from "react";
import { api, setAuth } from "../api";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import {
  cacheTasks,
  getAllTasksLocal,
  putTaskLocal,
  removeTaskLocal,
  getOutbox,
  removeFromOutbox,
  setMapping,
  getMapping,
} from "../offline/db";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import TaskComponent from './Task';

type Task = {
  _id: string;
  title: string;
  description?: string;
  status: "Pendiente" | "En Progreso" | "Completada";
  clienteId: string;
  createdAt?: string;
  deleted?: boolean;
};

type User = {
  name?: string;
  email?: string;
};

function normalizeTask(x: unknown): Task {
  const rawTask = x as Record<string, unknown>;
  const clientIdentifier = String(rawTask?.clienteId ?? rawTask?._id ?? rawTask?.id ?? crypto.randomUUID());
  return {
    _id: String(rawTask?._id ?? rawTask?.id),
    title: String(rawTask?.title ?? "(no title)"),
    description: rawTask?.description as string | undefined ?? "",
    status:
      rawTask?.status === "Completada" ||
      rawTask?.status === "En Progreso" ||
      rawTask?.status === "Pendiente"
        ? rawTask.status
        : "Pendiente",
    clienteId: clientIdentifier,
    createdAt: rawTask?.createdAt as string | undefined,
    deleted: !!rawTask?.deleted,
  };
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [user, setUser] = useState<User | null>(null);

  //Real-time connection status
  const isOnline = useOnlineStatus();

  // Initial load
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) setAuth(token);

    const controller = new AbortController();

    loadTasks(controller.signal);
    fetchProfile(controller.signal);

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-sync when returning online
  useEffect(() => {
    if (isOnline) {
      syncNow().catch(err => {
        console.error("Auto sync error:", err);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  async function fetchProfile(signal?: AbortSignal) {
    try {
      const { data } = await api.get("/api/auth/profile", { signal });
      setUser(data);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError' && err.name !== 'CanceledError') {
        console.warn("Profile could not be loaded:", err);
      }
    }
  }

  const loadTasks = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      let list: Task[] = [];
      if (navigator.onLine) {
        const { data } = await api.get("/api/tasks", { signal });
        const raw = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
        list = raw.map(normalizeTask);
        await cacheTasks(list);

        for (const task of list) {
          if (task._id && !task.clienteId.startsWith('cliente-')) {
            await setMapping(task._id, task._id);
          }
        }
      } else {
        list = await getAllTasksLocal();
      }
      setTasks(list);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError' && err.name !== 'CanceledError') {
        console.error("Error loading tasks:", err);
        try {
          const localTasks = await getAllTasksLocal();
          setTasks(localTasks);
        } catch (localErr) {
          console.error("Error loading local tasks:", localErr);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const syncNow = useCallback(async () => {
    console.log('Starting sync...');

    try {
      const { data } = await api.get("/api/tasks");
      const serverTasks = (Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [])
        .map(normalizeTask);

      const localTasks = await getAllTasksLocal();
      const ops = (await getOutbox()).sort((a, b) => a.ts - b.ts);

      console.log(`Server: ${serverTasks.length} tasks | Local: ${localTasks.length} tasks | Pending: ${ops.length} ops`);

      for (const op of ops) {
        try {
          switch (op.op) {
            case "create": {
              console.log(`Creating task: ${op.data.title}`);
              const { data: responseData } = await api.post("/api/tasks", {
                title: op.data.title,
                status: op.data.status,
                description: op.data.description || "",
              });

              const serverTask = normalizeTask(responseData);
              console.log(`Task created on server:`, serverTask);

              await setMapping(op.clienteId, serverTask._id);
              await putTaskLocal(serverTask);
              await removeFromOutbox(op.id);
              console.log(`Mapping created: ${op.clienteId} -> ${serverTask._id}`);
              break;
            }
            case "update": {
              const serverId = await getMapping(op.clienteId);
              if (!serverId) {
                console.warn(`Server ID not found for update: ${op.clienteId}`);
                await removeFromOutbox(op.id);
                continue;
              }

              console.log(`Updating task: ${serverId} (clientId: ${op.clienteId})`);
              await api.put(`/api/tasks/${serverId}`, {
                title: op.data.title,
                status: op.data.status,
                description: op.data.description || "",
              });

              const updatedTask = normalizeTask({ ...op.data, _id: serverId });
              await putTaskLocal(updatedTask);
              await removeFromOutbox(op.id);
              console.log(`Task updated: ${serverId}`);
              break;
            }
            case "delete": {
              const serverId = await getMapping(op.clienteId);
              if (!serverId) {
                console.warn(`Server ID not found for delete: ${op.clienteId}`);
                await removeFromOutbox(op.id);
                continue;
              }

              console.log(`Deleting task: ${serverId} (clientId: ${op.clienteId})`);
              await api.delete(`/api/tasks/${serverId}`);
              await removeTaskLocal(serverId);
              await removeFromOutbox(op.id);
              console.log(`Task deleted: ${serverId}`);
              break;
            }
          }
        } catch (err) {
          console.error(`Error syncing ${op.op}:`, err);
        }
      }
      
      const serverIds = new Set(serverTasks.map(t => t._id));

      const mappedLocalTasks = await Promise.all(
        localTasks.map(async (task: Task) => {
          const serverId = await getMapping(task.clienteId);
          return { ...task, mappedServerId: serverId };
        })
      );

      const localOnlyTasks = mappedLocalTasks.filter(
        t => !t.mappedServerId && !serverIds.has(t._id)
      );
      
      if (localOnlyTasks.length > 0) {
        console.log(`Uploading ${localOnlyTasks.length} offline tasks...`);
        
        for (const task of localOnlyTasks) {
          try {
            console.log(`Uploading: ${task.title}`);
            const { data: responseData } = await api.post("/api/tasks", {
              title: task.title,
              status: task.status,
              description: task.description || "",
            });
            
            const serverTask = normalizeTask(responseData);
            await setMapping(task.clienteId, serverTask._id);
            await putTaskLocal(serverTask);
            console.log(`Upload successful: ${task.clienteId} -> ${serverTask._id}`);
          } catch (err) {
            console.error(`Error uploading task ${task.title}:`, err);
          }
        }
      }

      await loadTasks();
      console.log('Sync complete');

    } catch (err) {
      console.error('Sync error:', err);
    }
  }, [loadTasks]);

  function logout() {
    localStorage.removeItem("token");
    setAuth(null);
    window.location.assign("/login");
  }

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "Completada").length;
    return { total, done, pending: total - done };
  }, [tasks]);

  return (
    <div className="wrap">
      <header className="topbar">
        <h1>
          My Notes
        </h1>

        {user && (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginLeft: "20px"
            }}
          >
            <img src="/iconopersona.svg" alt="Logo" width={40} />
            <span>Hello, {user.name}</span>
          </span>
        )}

        <div className="stats">
          <div className="stat-card todos" title="Total tasks">
            <div className="stat-icon">
              <img src="/Total.svg" alt="Total tasks" width={40} height={40} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{stats.total}</div>
              <div className="stat-label">Total</div>
            </div>
          </div>

          <div className="stat-card completadas" title="Completed tasks">
            <div className="stat-icon">
              <img src="/Completadas.svg" alt="Completed tasks" width={40} height={40} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{stats.done}</div>
              <div className="stat-label">Done</div>
            </div>
          </div>

          <div className="stat-card pendientes" title="Pending tasks">
            <div className="stat-icon">
              <img src="/Pendientes.svg" alt="Pending tasks" width={40} height={40} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{stats.pending}</div>
              <div className="stat-label">Pending</div>
            </div>
          </div>
        </div>

        <div className={`estado-conexion ${isOnline ? "online" : "offline"}`}>
          <img
            src={isOnline ? "/wifi.svg" : "/offline.svg"}
            alt={isOnline ? "Online" : "Offline"}
            width={40}
            height={40}
            style={{ marginRight: "8px" }}
          />
          {isOnline ? "Online" : "Offline"}
        </div>

        <button className="btn danger" onClick={logout} title="Sign out">
          <FontAwesomeIcon icon={["fas", "sign-out-alt"]} /> Logout
        </button>
      </header>

      <main className="tasks-section">
        {loading ? (
          <p>
            <FontAwesomeIcon icon={["fas", "spinner"]} spin /> Loading tasks...
          </p>
        ) : (
          <TaskComponent tasks={tasks} setTasks={setTasks} />
        )}
      </main>
    </div>
  );
}
