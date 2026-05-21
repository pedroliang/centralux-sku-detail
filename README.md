# CENTRALUX SKU DETAIL

Este é o site de consulta e cadastro de fotos das descrições das caixas master da **CENTRALUX**. 
O site foi projetado como uma **Single Page Application (SPA)** moderna, estática e serverless, ideal para ser hospedada gratuitamente no **GitHub Pages**.

## 🚀 Recursos
- **Pesquisa Inteligente**: Pesquise por código do produto ou descrição, com suporte para termos em qualquer ordem (ex: pesquisar "fita azul" encontrará "fita isolante 10m azul").
- **Cadastro e Upload de Fotos**: Faça o upload de fotos de referência das caixas master diretamente do navegador.
- **Armazenamento Otimizado**: Fotos são armazenadas na **Cloudinary** e os mapeamentos de SKU para imagem são registrados no **Firebase Firestore**.
- **Design Premium**: Visual moderno e fluído, livre de aparência de gerador IA, com suporte a **Modo Escuro (Dark Mode)** automático/manual.
- **Rápido e Fluído**: Implementado com rolagem infinita (Lazy Loading) para lidar com mais de 2.400 itens sem perda de desempenho.

---

## 🛠️ Como Funciona a Arquitetura (Sem Servidor)
Como o site é hospedado de forma estática no GitHub Pages:
1. **Google Sheets**: O aplicativo busca em tempo real os dados da planilha pública (aba *Estoque Sistema*) via exportação de CSV com CORS habilitado.
2. **Firestore REST API**: As fotos cadastradas são lidas e gravadas utilizando a API REST oficial do Firebase. Isso descarta a necessidade de inicializar SDKs pesados e chaves privadas no front-end.
3. **Cloudinary Unsigned Uploads**: O upload é feito diretamente do navegador utilizando um *Upload Preset não assinado*, o que protege suas chaves de API secretas de ficarem expostas ao público.

---

## 📦 Configuração Inicial (Importante)

### 1. Cloudinary (Upload Preset)
Para que o upload de fotos funcione, você precisa habilitar um **Upload Preset não assinado (Unsigned)** no seu painel da Cloudinary:
1. Faça login na [Cloudinary](https://cloudinary.com/).
2. Clique no ícone de engrenagem (**Settings**) no canto inferior esquerdo.
3. Acesse a aba **Upload**.
4. Role a página até encontrar a seção **Upload presets** e clique em **Add upload preset**.
5. Altere o campo **Signing Mode** de *Signed* para **Unsigned**.
6. (Opcional) Copie o nome gerado (ex: `ml_default` ou dê um nome customizado como `centralux_preset`).
7. Defina a pasta padrão de salvamento se desejar.
8. Salve as alterações.
9. No site da Centralux, abra o painel de **Configurações** (ícone de engrenagem) e insira o nome do seu Preset no campo correspondente.

### 2. Controle de Acesso / Senha de Cadastro
Para evitar que usuários não autorizados alterem fotos ou façam novos envios, você pode configurar uma senha no painel de **Configurações** do site. Uma vez salva a senha, o site solicitará a senha local para permitir qualquer ação de Upload ou Exclusão.

---

## 💻 Executando Localmente
Basta abrir o arquivo `index.html` diretamente no seu navegador, ou executar um servidor local leve:
```bash
# Se tiver Node.js instalado, você pode usar o npx para rodar um servidor:
npx serve .
```

---

## 🌐 Publicação no GitHub Pages
O site é totalmente compatível com o GitHub Pages. O repositório já foi criado. Para lançar:
1. Inicialize o repositório git local.
2. Faça commit dos arquivos.
3. Envie para o branch `main` do GitHub.
4. Acesse as configurações do repositório no GitHub -> **Pages** -> Selecione a fonte **Deploy from a branch** e selecione o branch **main** (pasta `/root`).

O site estará disponível no endereço:
`https://pedroliang.github.io/centralux-sku-detail/`
