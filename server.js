const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Servidor de señalización NEXO funcionando correctamente.');
});

const wss = new WebSocket.Server({ server });

// Estructura: salas['nombre-sala'] = Map(id -> { socket, nombre })
const salas = {};

function generarId() {
  return crypto.randomBytes(6).toString('hex');
}

function obtenerSala(nombreSala) {
  if (!salas[nombreSala]) {
    salas[nombreSala] = new Map();
  }
  return salas[nombreSala];
}

wss.on('connection', (socket) => {
  socket.id = generarId();
  socket.sala = null;

  socket.on('message', (mensajeCrudo) => {
    let mensaje;
    try {
      mensaje = JSON.parse(mensajeCrudo.toString());
    } catch (e) {
      return;
    }

    // Un cliente pide unirse a una sala
    if (mensaje.tipo === 'unirse') {
      const nombreSala = mensaje.sala || 'principal';
      const nombre = mensaje.nombre || 'Invitado';
      socket.sala = nombreSala;
      socket.nombre = nombre;

      const participantes = obtenerSala(nombreSala);

      // Armamos la lista de quienes ya estaban antes de que este se sume
      const listaExistente = [];
      participantes.forEach((datos, idExistente) => {
        listaExistente.push({ id: idExistente, nombre: datos.nombre });
      });

      participantes.set(socket.id, { socket, nombre });

      socket.send(JSON.stringify({
        tipo: 'sala-actual',
        miId: socket.id,
        participantes: listaExistente
      }));

      // Avisamos a los que ya estaban que se sumo alguien nuevo
      participantes.forEach((datos, idExistente) => {
        if (idExistente !== socket.id) {
          datos.socket.send(JSON.stringify({
            tipo: 'nuevo-participante',
            id: socket.id,
            nombre: nombre
          }));
        }
      });

      console.log(`"${nombre}" se unio a la sala "${nombreSala}". Total: ${participantes.size}`);
      return;
    }

    // Mensajes dirigidos a un participante especifico (oferta, respuesta, candidato ICE)
    if (mensaje.para && socket.sala && salas[socket.sala]) {
      const participantes = salas[socket.sala];
      const destino = participantes.get(mensaje.para);
      if (destino && destino.socket.readyState === WebSocket.OPEN) {
        mensaje.de = socket.id;
        destino.socket.send(JSON.stringify(mensaje));
      }
    }
  });

  socket.on('close', () => {
    if (!socket.sala || !salas[socket.sala]) return;
    const participantes = salas[socket.sala];
    participantes.delete(socket.id);
    console.log(`Alguien salio de la sala "${socket.sala}". Total: ${participantes.size}`);

    participantes.forEach((datos) => {
      datos.socket.send(JSON.stringify({
        tipo: 'participante-salio',
        id: socket.id
      }));
    });

    if (participantes.size === 0) {
      delete salas[socket.sala];
    }
  });
});

server.listen(PORT, () => {
  console.log(`Servidor de señalización escuchando en el puerto ${PORT}`);
});

