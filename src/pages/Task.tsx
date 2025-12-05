import { useMemo, useState, useEffect } from "react";
import { api } from "../api";
import { 
  queue, 
  putTaskLocal, 
  removeTaskLocal, 
  getMapping, 
  setMapping, 
  getOutbox, 
  removeFromOutbox, 
  type OutboxOp,
  type OutboxTaskData,
  outboxDataToTask,
} from "../offline/db";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

type Task = {
  _id: string;
  title: string;
  description?: string;
  status: "Pendiente" | "En Progreso" | "Completada";
  clienteId: string;
  createdAt?: string;
  deleted?: boolean;
};

type TaskProps = {
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
};

type ApiError = {
  response?: {
    status: number;
    data?: unknown;
  };
  message: string;
};

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error
  );
}

export default function TaskPage({ tasks, setTasks }: TaskProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingSync, setPendingSync] = useState(0);


  // Normaliza datos del backend

  function normalizeTask(x: unknown): Task {
    const rawTask = x as Record<string, unknown>;
    const clientIdentifier = String(rawTask?.clienteId ?? rawTask?._id ?? rawTask?.id ?? crypto.randomUUID());
    
    // Función mejorada para validar status
    const statusValue = String(rawTask?.status);
    let validatedStatus: "Pendiente" | "En Progreso" | "Completada";
    
    if (statusValue === "Pendiente" || statusValue === "En Progreso" || statusValue === "Completada") {
      validatedStatus = statusValue;
    } else {
      validatedStatus = "Pendiente"; // Valor por defecto
    }
    
    return {
      _id: String(rawTask?._id ?? rawTask?.id),
      title: String(rawTask?.title ?? "(sin título)"),
      description: String(rawTask?.description ?? ""),
      status: validatedStatus,
      clienteId: clientIdentifier,
      createdAt: rawTask?.createdAt as string | undefined,
      deleted: !!rawTask?.deleted,
    };
  }


  // Actualiza el contador de pendientes

  async function updatePendingCount() {
    const allPending = await getOutbox();
    setPendingSync(allPending?.length ?? 0);
  }


  // Sincroniza tareas pendientes

  async function syncPendingTasks() {
    if (!navigator.onLine) return;

    console.log('Sincronizando tareas desde Task.tsx...');
    const allPending = await getOutbox();
    
    if (allPending.length === 0) {
      console.log('No hay tareas pendientes de sincronizar');
      return;
    }

    console.log(`Sincronizando ${allPending.length} operaciones pendientes...`);

    for (const op of allPending) {
      try {
        if (op.op === "create") {
          console.log(`Creando tarea: ${op.data.title}`);
          
          // CORRECCIÓN: Enviar solo los campos que el backend espera
          const { data } = await api.post("/api/tasks", {
            title: op.data.title,
            description: op.data.description,
            status: op.data.status,
          });
          
          const serverTask = normalizeTask(data);
          await setMapping(op.clienteId, serverTask._id);
          await putTaskLocal(serverTask);
          
          // Actualizar en el estado local
          setTasks(prev => prev.map(t => 
            t.clienteId === op.clienteId ? serverTask : t
          ));
          
          await removeFromOutbox(op.id);
          console.log(`Tarea creada: ${serverTask._id}`);
          
        } else if (op.op === "update") {
          const serverId = await getMapping(op.clienteId);
          if (!serverId) {
            console.warn(`⚠️ No se encontró serverId para actualizar: ${op.clienteId}`);
            await removeFromOutbox(op.id);
            continue;
          }
          
          console.log(`Actualizando tarea: ${serverId}`);
          
          // CORRECCIÓN: Enviar solo los campos que el backend espera
          await api.put(`/api/tasks/${serverId}`, {
            title: op.data.title,
            description: op.data.description,
            status: op.data.status,
          });
          
          // 🔹 CORRECCIÓN: Convertir OutboxTaskData a Task
          const updatedTask = outboxDataToTask({ ...op.data, _id: serverId });
          await putTaskLocal(updatedTask);
          
          setTasks(prev => prev.map(t => 
            t._id === serverId || t.clienteId === op.clienteId ? updatedTask : t
          ));
          
          await removeFromOutbox(op.id);
          console.log(`Tarea actualizada: ${serverId}`);
          
        } else if (op.op === "delete") {
          if (!op.clienteId) {
            console.log('Operación DELETE sin clienteId');
            await removeFromOutbox(op.id);
            continue;
          }
          
          const serverId = await getMapping(op.clienteId);
          if (!serverId) {
            console.log('Tarea local eliminada (sin serverId en sync)');
            await removeFromOutbox(op.id);
            continue;
          }
          
          console.log(`Sincronizando DELETE: ${serverId}`);
          
          try {
            await api.delete(`/api/tasks/${serverId}`);
            
            // Si llegamos aquí, fue exitoso, eliminamos localmente
            await removeTaskLocal(serverId);
            setTasks(prev => prev.filter(t => 
              t._id !== serverId && t.clienteId !== op.clienteId
            ));
            
            await removeFromOutbox(op.id);
            console.log(`Tarea eliminada en sync: ${serverId}`);
            
          } catch (error: unknown) {
            if (isApiError(error) && error.response?.status === 404) {
              console.log(`Tarea no encontrada durante sync DELETE: ${serverId}`);
              // La tarea ya no existe en el servidor, podemos limpiar
              await removeFromOutbox(op.id);
              console.log('Operación DELETE limpiada (recurso no existe)');
            } else {
              console.error(`Error sincronizando DELETE:`, error);
              // No removemos la operación si es otro tipo de error
            }
          }
        }
      } catch (error: unknown) {
        // Manejar errores 404 específicamente
        if (isApiError(error) && error.response?.status === 404) {
          console.log(`Recurso no encontrado en servidor para ${op.op}, limpiando...`);
          
          if (op.op === "delete" || op.op === "update") {
            // Para DELETE/UPDATE de recursos que no existen, limpiamos
            await removeFromOutbox(op.id);
            
            if (op.op === "delete") {
              // Ya fue eliminado localmente, solo limpiamos mapping
              console.log('Limpiando mapping de recurso inexistente');
            }
          }
        } else {
          console.error(`Error sincronizando ${op.op}:`, error);
          // No removemos la operación si es otro tipo de error
        }
      }
    }
    
    await updatePendingCount();
    console.log('Sincronización completada');
  }


  // Agregar tarea - VERSIÓN CORREGIDA

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    const d = description.trim();
    if (!t || !d) return;

    const clienteId = String(crypto.randomUUID());
    const newTask: Task = {
      _id: clienteId,
      title: t,
      description: d,
      status: "Pendiente",
      clienteId,
      createdAt: new Date().toISOString(),
    };

    setTasks((prev) => [newTask, ...prev]);
    await putTaskLocal(newTask);
    setTitle("");
    setDescription("");

    // 🔹 CORRECCIÓN: Datos completamente limpios
    const operationData: OutboxTaskData = {
      _id: String(newTask._id),
      title: String(newTask.title),
      description: String(newTask.description),
      status: String(newTask.status),
      clienteId: String(newTask.clienteId),
      createdAt: String(newTask.createdAt),
      deleted: Boolean(newTask.deleted || false)
    };

    const operation: OutboxOp = {
      id: String(crypto.randomUUID()),
      op: "create" as const,
      clienteId: String(clienteId),
      data: operationData,
      ts: Number(Date.now()),
    };

    console.log('Agregando tarea - Operación:', JSON.stringify(operation, null, 2));

    if (navigator.onLine) {
      try {
        const { data } = await api.post("/api/tasks", { 
          title: t,
          description: d,
          status: "Pendiente",
        });
        
        const serverTask = normalizeTask(data);
        await setMapping(clienteId, serverTask._id);
        await putTaskLocal(serverTask);
        
        setTasks(prev => prev.map(t => 
          t.clienteId === clienteId ? serverTask : t
        ));
        console.log('Tarea creada en servidor');
      } catch {
        console.log('Error de conexión, encolando operación CREATE');
        await queue(operation);
      }
    } else {
      console.log('Offline - Encolando operación CREATE');
      await queue(operation);
    }

    updatePendingCount();
  }

    async function changeTaskStatus(task: Task, newStatus: "Pendiente" | "En Progreso" | "Completada") {
    const updated: Task = { ...task, status: newStatus };

    setTasks((prev) => prev.map((x) => (x._id === task._id ? updated : x)));
    await putTaskLocal(updated);

    // 🔹 CORRECCIÓN: Crear datos completamente limpios para IndexedDB
    const operationData: OutboxTaskData = {
      _id: String(task._id || ''),
      title: String(task.title || ''),
      description: String(task.description || ''),
      status: String(newStatus),
      clienteId: String(task.clienteId || ''),
      createdAt: String(task.createdAt || new Date().toISOString()),
      deleted: Boolean(task.deleted || false)
    };

    const operation: OutboxOp = {
      id: String(crypto.randomUUID()),
      op: "update" as const,
      clienteId: String(task.clienteId),
      data: operationData,
      ts: Number(Date.now()),
    };

    console.log('Cambiando estado - Operación:', JSON.stringify(operation, null, 2));

    if (navigator.onLine) {
      try {
        const serverId = await getMapping(task.clienteId);
        
        if (!serverId) {
          console.log('Tarea local actualizada (nunca sincronizada)');
          await queue(operation);
          return;
        }
        
        await api.put(`/api/tasks/${serverId}`, { 
          status: newStatus 
        });
        console.log('Estado actualizado en servidor');
      } catch (error: unknown) {
        if (isApiError(error) && error.response?.status === 404) {
          console.log('Tarea no encontrada en servidor, encolando operación');
          await queue(operation);
        } else {
          console.log('Error de conexión, encolando operación');
          await queue(operation);
        }
      }
    } else {
      console.log('Offline - Encolando operación UPDATE');
      await queue(operation);
    }

    updatePendingCount();
  }


  // Editar tarea (iniciar)

  function startEdit(task: Task) {
    setEditingId(task._id);
    setEditingTitle(task.title);
    setEditingDescription(task.description ?? "");
  }


  // Editar tarea (guardar) - VERSIÓN CORREGIDA

  async function saveEdit(taskId: string) {
    const newTitle = editingTitle.trim();
    const newDescription = editingDescription.trim();
    if (!newTitle || !newDescription) return;

    const before = tasks.find((t) => t._id === taskId);
    if (!before) return;

    const updated: Task = { ...before, title: newTitle, description: newDescription };
    setTasks((prev) => prev.map((t) => (t._id === taskId ? updated : t)));
    setEditingId(null);
    await putTaskLocal(updated);

    // 🔹 CORRECCIÓN: Datos completamente limpios
    const operationData: OutboxTaskData = {
      _id: String(updated._id),
      title: String(updated.title),
      description: String(updated.description),
      status: String(updated.status),
      clienteId: String(updated.clienteId),
      createdAt: String(updated.createdAt || new Date().toISOString()),
      deleted: Boolean(updated.deleted || false)
    };

    const operation: OutboxOp = {
      id: String(crypto.randomUUID()),
      op: "update" as const,
      clienteId: String(updated.clienteId),
      data: operationData,
      ts: Number(Date.now()),
    };

    console.log('Guardando edición - Operación:', JSON.stringify(operation, null, 2));

    if (navigator.onLine) {
      try {
        const serverId = await getMapping(updated.clienteId);
        
        if (!serverId) {
          console.log('Tarea local actualizada (nunca sincronizada)');
          await queue(operation);
          return;
        }
        
        await api.put(`/api/tasks/${serverId}`, { 
          title: newTitle,
          description: newDescription
        });
        console.log('Tarea actualizada en servidor');
      } catch (error: unknown) {
        if (isApiError(error) && error.response?.status === 404) {
          console.log('Tarea no encontrada en servidor, encolando operación');
          await queue(operation);
        } else {
          console.log('Error de conexión, encolando operación');
          await queue(operation);
        }
      }
    } else {
      console.log('Offline - Encolando operación UPDATE');
      await queue(operation);
    }

    updatePendingCount();
  }


  // Eliminar tarea - VERSIÓN CORREGIDA

  async function removeTask(taskId: string) {
    const task = tasks.find((t) => t._id === taskId);
    if (!task) return;

    console.log(`Intentando eliminar tarea:`, task);

    setTasks((prev) => prev.filter((t) => t._id !== taskId));
    await removeTaskLocal(taskId);

    // 🔹 CORRECCIÓN: Para DELETE, solo necesitamos datos básicos
    const operation: OutboxOp = {
      id: String(crypto.randomUUID()),
      op: "delete" as const,
      clienteId: String(task.clienteId),
      ts: Number(Date.now()),
    };

    console.log('Eliminando tarea - Operación:', operation);

    if (navigator.onLine) {
      try {
        const serverId = await getMapping(task.clienteId);
        
        if (!serverId) {
          console.log('Tarea local eliminada (nunca sincronizada)');
          // Buscar y eliminar cualquier operación pendiente de CREATE para esta tarea
          const outbox = await getOutbox();
          const createOp = outbox.find(op => 
            op.op === "create" && op.clienteId === task.clienteId
          );
          if (createOp) {
            await removeFromOutbox(createOp.id);
            console.log('Operación CREATE pendiente también eliminada');
          }
          return;
        }
        
        console.log(`Eliminando tarea del servidor: ${serverId}`);
        const response = await api.delete(`/api/tasks/${serverId}`);
        console.log('Tarea eliminada del servidor:', response.data);
        
      } catch (error: unknown) {
        if (isApiError(error) && error.response?.status === 404) {
          console.log('Tarea no encontrada en servidor (404)');
        } else {
          console.log('Error de conexión, encolando operación DELETE');
          await queue(operation);
        }
      }
    } else {
      console.log('Offline - Encolando operación DELETE');
      await queue(operation);
    }

    await updatePendingCount();
  }


  // Función para limpiar tareas huérfanas (temporal)

  async function cleanupOrphanedTasks() {
    if (!online) return;
    
    console.log('Buscando tareas huérfanas...');
    const allTasks = tasks;
    
    for (const task of allTasks) {
      const serverId = await getMapping(task.clienteId);
      if (serverId) {
        try {
          // Verificar si la tarea existe en el servidor
          await api.get(`/api/tasks/${serverId}`);
        } catch (error) {
          if (isApiError(error) && error.response?.status === 404) {
            console.log(`Eliminando tarea huérfana: ${task.title}`);
            // La tarea no existe en el servidor, eliminarla localmente
            setTasks(prev => prev.filter(t => t._id !== task._id));
            await removeTaskLocal(task._id);
          }
        }
      }
    }
  }


  // Filtrar tareas

  const filtered = useMemo(() => {
    let list = tasks;
    if (search.trim()) list = list.filter((t) =>
      (t.title || "").toLowerCase().includes(search.toLowerCase()) ||
      (t.description || "").toLowerCase().includes(search.toLowerCase())
    );
    if (filter === "active") list = list.filter((t) => t.status !== "Completada");
    if (filter === "completed") list = list.filter((t) => t.status === "Completada");
    return list;
  }, [tasks, search, filter]);


  // Detecta online/offline y sincroniza automáticamente

  useEffect(() => {
    function handleOnline() { 
      setOnline(true); 
      syncPendingTasks();
      // Limpiar tareas huérfanas cuando volvemos online
      cleanupOrphanedTasks();
    }
    function handleOffline() { setOnline(false); }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const interval = setInterval(() => setOnline(navigator.onLine), 5000);
    updatePendingCount();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  },);


  // Debug: mostrar estado actual de tareas

  useEffect(() => {
    console.log('Estado actual de tareas:', {
      total: tasks.length,
      tareas: tasks.map(t => ({
        _id: t._id,
        clienteId: t.clienteId,
        title: t.title,
        description: t.description,
        status: t.status
      }))
    });
  }, [tasks]);


// Render

return (
  <main>

    <form className="add" onSubmit={addTask}>
      <input 
        value={title} 
        onChange={(e) => setTitle(e.target.value)} 
        placeholder="Task title*" 
        required 
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Task description *"
        required
        rows={3}
      />
      <button className="btn" title="Agregar Tarea" type="submit">
        <FontAwesomeIcon icon="plus" /> Add
      </button>
    </form>

    <div className="toolbar">
      <input className="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." />

      <div className="filters">
        <button
          className={`chip ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}
          type="button"
        >
          <img src="/Total.svg" alt="Total" width={20} height={20} />
          <span>Total</span>
        </button>

        <button
          className={`chip ${filter === "active" ? "active" : ""}`}
          onClick={() => setFilter("active")}
          type="button"
        >
          <img src="/Pendientes.svg" alt="Pending" width={20} height={20} />
          <span>Pending</span>
        </button>

        <button
          className={`chip ${filter === "completed" ? "active" : ""}`}
          onClick={() => setFilter("completed")}
          type="button"
        >
          <img src="/Completadas.svg" alt="Done" width={20} height={20} />
          <span>Done</span>
        </button>
      </div>

    </div>

    {filtered.length === 0 ? (
      <p className="empty">No tasks found</p>
    ) : (
      <ul className="list">
        {filtered.map((t, idx) => (
          <li 
            key={t._id || t.clienteId || idx} 
            className={`item ${t.status.toLowerCase().replace(' ', '-')}`}
            style={{ '--item-index': idx } as React.CSSProperties}
          >
            <div className="status-selector">
              <select 
                value={t.status} 
                onChange={(e) => changeTaskStatus(t, e.target.value as "Pendiente" | "En Progreso" | "Completada")}
                className={`status-select status-${t.status.toLowerCase().replace(' ', '-')}`}
              >
                <option value="Pendiente">Pending</option>
                <option value="En Progreso">In progress</option>
                <option value="Completada">Completed</option>
              </select>
            </div>

            <div className="task-content">
              {editingId === t._id ? (
                <div className="edit-form">
                  <input 
                    className="edit-title" 
                    value={editingTitle} 
                    onChange={(e) => setEditingTitle(e.target.value)} 
                    onKeyDown={(e) => e.key === "Enter" && saveEdit(t._id)} 
                    placeholder="Título *"
                  />
                  <textarea
                    className="edit-description"
                    value={editingDescription}
                    onChange={(e) => setEditingDescription(e.target.value)}
                    placeholder="Descripción *"
                    rows={3}
                  />
                  <div className="edit-actions">
                    <button className="btn small" onClick={() => saveEdit(t._id)}>Save</button>
                    <button className="btn small" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="title" onDoubleClick={() => startEdit(t)}>
                    {t.title || "(Empty)"}
                  </span>
                  <span className="description" onDoubleClick={() => startEdit(t)}>
                    {t.description || "(Empty)"}
                  </span>
                </>
              )}
            </div>

            <div className="actions">
              {editingId !== t._id && (
                <button className="icon" onClick={() => startEdit(t)} title="Edit Task">
                  <FontAwesomeIcon icon="pencil-alt" />
                </button>
              )}
              <button className="icon danger" onClick={() => removeTask(t._id)} title="Delete Task">
                <FontAwesomeIcon icon="trash-alt" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    )}
  </main>
);
}