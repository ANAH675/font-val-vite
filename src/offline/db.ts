import { openDB, type IDBPDatabase } from "idb";


// TIPOS


export type Task = {
  _id: string;
  title: string;
  description?: string;
  status: "Pendiente" | "En Progreso" | "Completada";
  clienteId: string;
  createdAt?: string;
  deleted?: boolean;
};

// Tipo para datos de operación (sin las restricciones estrictas de Task)
export type OutboxTaskData = {
  _id: string;
  title: string;
  description?: string;
  status: string; // 🔹 Cambiado a string para flexibilidad
  clienteId: string;
  createdAt?: string;
  deleted?: boolean;
};

export type OutboxOp =
  | { id: string; op: "create"; clienteId: string; data: OutboxTaskData; ts: number }
  | { id: string; op: "update"; serverId?: string; clienteId: string; data: OutboxTaskData; ts: number }
  | { id: string; op: "delete"; serverId?: string; clienteId?: string; ts: number };

type DBSchema = {
  tasks: { key: string; value: Task };
  outbox: { key: string; value: OutboxOp };
  meta: { key: string; value: { _id: string; serverId: string } };
};


// CONEXIÓN A INDEXEDDB


let dbp: Promise<IDBPDatabase<DBSchema>>;

export function db() {
  if (!dbp) {
    dbp = openDB<DBSchema>("todo-pwa", 1, {
      upgrade(d) {
        d.createObjectStore("tasks", { keyPath: "_id" });
        d.createObjectStore("outbox", { keyPath: "id" });
        d.createObjectStore("meta", { keyPath: "_id" });
      },
    });
  }
  return dbp;
}

export function validateOutboxOp(op: OutboxOp): OutboxOp {
  // Para operaciones CREATE y UPDATE, limpiar los datos
  if (op.op === 'create' || op.op === 'update') {
    const cleanData: OutboxTaskData = {
      _id: String(op.data._id || ''),
      title: String(op.data.title || ''),
      description: String(op.data.description || ''),
      status: String(op.data.status || 'Pendiente'),
      clienteId: String(op.data.clienteId || ''),
      createdAt: String(op.data.createdAt || new Date().toISOString()),
      deleted: Boolean(op.data.deleted || false)
    };

    return {
      ...op,
      id: String(op.id),
      clienteId: String(op.clienteId),
      data: cleanData,
      ts: Number(op.ts)
    };
  }

  // Para operaciones DELETE
  return {
    ...op,
    id: String(op.id),
    clienteId: op.clienteId ? String(op.clienteId) : undefined,
    ts: Number(op.ts)
  };
}


// FUNCIONES DE TAREAS LOCALES


export async function cacheTasks(list: Task[]): Promise<void> {
  const tx = (await db()).transaction("tasks", "readwrite");
  const store = tx.objectStore("tasks");
  await store.clear();
  for (const t of list) {
    await store.put(t);
  }
  await tx.done;
}

export async function putTaskLocal(task: Task): Promise<void> {
  const tx = (await db()).transaction("tasks", "readwrite");
  await tx.store.put(task);
  await tx.done;
}

export async function getAllTasksLocal(): Promise<Task[]> {
  return (await (await db()).getAll("tasks")) || [];
}

export async function removeTaskLocal(id: string): Promise<void> {
  await (await db()).delete("tasks", id);
}


// FUNCIONES DE COLA DE SINCRONIZACIÓN


export async function queue(op: OutboxOp): Promise<void> {
  const cleanOp = validateOutboxOp(op);
  console.log('📝 Encolando operación limpia:', JSON.stringify(cleanOp, null, 2));
  await (await db()).put("outbox", cleanOp);
}

export async function getOutbox(): Promise<OutboxOp[]> {
  return (await (await db()).getAll("outbox")) || [];
}

export async function clearOutbox(): Promise<void> {
  const tx = (await db()).transaction("outbox", "readwrite");
  await tx.store.clear();
  await tx.done;
}

export async function removeFromOutbox(opId: string): Promise<void> {
  await (await db()).delete("outbox", opId);
}


// FUNCIONES DE MAPEO CLIENTE-SERVIDOR


export async function setMapping(clienteId: string, serverId: string): Promise<void> {
  await (await db()).put("meta", { _id: clienteId, serverId });
}

export async function getMapping(clienteId: string): Promise<string | undefined> {
  const result = await (await db()).get("meta", clienteId);
  return result?.serverId;
}


// FUNCIONES AUXILIARES


// Función para validar el status
export function validateStatus(status: string): "Pendiente" | "En Progreso" | "Completada" {
  if (status === "Completada" || status === "En Progreso" || status === "Pendiente") {
    return status;
  }
  return "Pendiente";
}

// Función para convertir OutboxTaskData a Task
export function outboxDataToTask(data: OutboxTaskData): Task {
  return {
    _id: data._id,
    title: data.title,
    description: data.description,
    status: validateStatus(data.status),
    clienteId: data.clienteId,
    createdAt: data.createdAt,
    deleted: data.deleted,
  };
}

// Función para convertir Task a OutboxTaskData
export function taskToOutboxData(task: Task): OutboxTaskData {
  return {
    _id: task._id,
    title: task.title,
    description: task.description,
    status: task.status, // Se mantiene como string específico
    clienteId: task.clienteId,
    createdAt: task.createdAt,
    deleted: task.deleted,
  };
}