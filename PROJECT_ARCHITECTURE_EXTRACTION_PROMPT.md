# AI Financial Research Project Architecture Extraction Prompt

## Role

You are a senior AI architect, backend engineer, data engineer, and financial AI system auditor.

Your task is NOT to redesign the project.

Your task is to document the existing project exactly as it is.

Do not assume anything exists.
If information is missing, write:

MISSING INFORMATION

Do not invent technologies, databases, agents, APIs, or workflows.

The final output will be reviewed by another AI architect for:
- accuracy
- scalability
- security
- hallucination risks
- production readiness


# Project Identity

## Project Name

Answer:

## Main Objective

What problem does this project solve?

## Target Users

Who uses this system?

## Current Status

- Prototype
- MVP
- Production
- Internal tool


---

# 1. Complete System Architecture

Provide the complete architecture diagram.

Format:


USER

|

Frontend

|

API Gateway

|

Backend Services

|

AI Layer

|

Databases

|

External Services



Explain every component:

Component name:

Purpose:

Technology:

Why chosen:

Input:

Output:

Dependencies:


---

# 2. Frontend Architecture

Explain:

Framework:

Example:
React / Next.js / Vue

Hosting:

State management:

Authentication:

UI libraries:

Charts:

Tables:

Streaming:

API communication:

File structure:


frontend/
|
|-- components
|-- pages
|-- hooks
|-- services



Explain:

How does a user request research?

How does the frontend display:

- reports
- citations
- tables
- sources
- confidence scores


---

# 3. Backend Architecture

Explain:

Backend framework:

Language:

Hosting:

API structure:

Services:

Controllers:

Routes:

Middleware:

Background jobs:

Queues:


Provide:


backend/

controllers/

services/

agents/

database/

utils/



Explain request lifecycle:

Example:

User question

↓

API

↓

Research engine

↓

Database

↓

Response


---

# 4. AI Model Architecture

List every AI component.

For each:

Name:

Purpose:

Model:

Provider:

Version:

Temperature:

Context window:

Cost:

Latency:


Example:

Research Planner Agent

Input:

Output:


---

# 5. Agent System

List all agents.

For each:

Agent name:

Role:

Prompt:

Input:

Output:

Tools available:

Memory:

Failure handling:


Example:

## Retrieval Agent

Purpose:

Search documents.

Input:

Question.

Output:

Evidence.


---

# 6. Data Sources

List all external data.

## Financial Data

Sources:

- SEC
- Bloomberg
- Reuters
- APIs
- Other


For each:

Collection method:

Frequency:

Format:

Validation:


## Documents

Types:

- 10-K
- 10-Q
- Earnings calls
- News
- Research reports


Historical coverage:


---

# 7. Data Storage Architecture


## SQL Database

Technology:

Tables:

Provide schema:



TABLE NAME:

columns:

relationships:



Explain:

What is the source of truth?


## Vector Database

Technology:

Example:
Qdrant


Collections:


Embedding model:


Chunk size:


Metadata:


Filtering:


Reranking:


---

# 8. Document Processing Pipeline


Explain:

Raw document

↓

Parser

↓

Cleaning

↓

Chunking

↓

Embedding

↓

Storage

↓

Retrieval


Tools:

PDF parser:

OCR:

Table extraction:

Metadata extraction:


Explain how tables are handled.


---

# 9. RAG Architecture


Explain:

User query:

↓

Query understanding:

↓

Retrieval:

↓

Ranking:

↓

Context selection:

↓

LLM generation:


Include:

Search strategy:

Keyword search:

Vector search:

Hybrid search:

Reranking:


---

# 10. Financial Accuracy System


Explain how you prevent:


Wrong numbers:

Wrong fiscal year:

Wrong company:

Wrong currency:

Wrong GAAP/non-GAAP:

Wrong calculations:

Outdated information:


Do you have:

Financial facts database?

YES/NO


Citation system?

YES/NO


Claim verification?

YES/NO


Calculation engine?

YES/NO


---

# 11. Citation System


Explain:

How are citations generated?


Stored where?


Example output:



Claim:

Source:

Page:

Document:

Confidence:



---

# 12. Auto Audit System


Explain whether you have:


Source verification:

Claim verification:

Fact checking:

Calculation checking:

Contradiction detection:

Confidence scoring:


Provide example:



AUDIT RESULT:

PASS/FAIL

Reason:



---

# 13. Evaluation System


Explain:


Do you have benchmarks?


Number of tests:


Test categories:


Metrics:


Example:


Accuracy:

Retrieval recall:

Citation accuracy:

Latency:


---

# 14. Memory System


Explain:


User memory:

Research memory:

Document memory:

Conversation memory:


Storage:

Retrieval:


---

# 15. Security


Explain:


Authentication:

Authorization:

API security:

Secrets:

Database security:

Prompt injection protection:

Data poisoning protection:


---

# 16. Deployment


Explain:


Infrastructure:

Cloud provider:

Containers:

CI/CD:

Monitoring:

Logging:

Scaling:


---

# 17. Current Problems


List all known problems:

Accuracy issues:

Latency:

Cost:

Hallucinations:

Missing features:


Provide examples of bad outputs.


---

# 18. Final Architecture Summary


Provide:

Complete architecture diagram.

Technology stack.

Data flow.

AI flow.

Weaknesses.

Unknown parts.


END DOCUMENT
