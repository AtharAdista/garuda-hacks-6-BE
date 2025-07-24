import { server } from "./app/web"

import "dotenv/config"

const port = process.env.PORT;

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
