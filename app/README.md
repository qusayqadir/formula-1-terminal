- [ ] **chatbot**
  - [x] server-side events to show agent thinking to user
  - [x] Add multi-turn chatbot conversation support
  - [ ] build evals for regulation docs 
    - [ ] decide on a threshold accuracy and lifecycle add FIA regs for prev seasons 
  - [x] imporve agent response latency ( imporve ux while waiting for response ? ) 
  - [x] take generated sql data and build image to server via data vis graph
  - [ ] add keyword search to acoomplish hybrid search 
  - [x] store chat sessions (very low priority) 

- [ ] **historical dashboard** 
  - [x] Ingest qualifying results
  - [x] head to head quali results widget 
  - [ ] ~~Ingest sprint qualifying results ( no data )~~ 
  - [x] Ingest sprint results
  - [x] ++ingest pitstop data++
  - [x] ++ingest lap data++ 
    - [x] ++race recap just for 2025 season++ 
    - [x] ingest all data backlog for all the years in pitstops, laps, quali ( everything available between 2011 and 2026 ) 
    - [x] fix issue to assume driver is retired when in reality they have been lapped and didnt finsih all laps of rac
  - [x] add way more laps. 
  - [ ] ingest race control data - openf1 
  - [ ] ingest driver cost data ( for each crash how much they were liable for? )  find api for this data 
  - [ ] driver career stats? WC, Wins, Poles? in team profiles 
  - [ ] fix design for historical data to enable automatoin 
    - [ ] eventbridge? have an agent manually right all the triggers for the 
  - [ ] incremental poller, checkpointing, logging, reconciliation if upstream data corrects itself later

- [ ] **live dashboard** 
  - [ ] respond to openf1 to gain access and confirm api access keys
  - [ ] config kineses, and lamda pollers and publisher 
  - [x] use all the lap data, pitstop data, and then find a way to get the race stint data and which tire compond the driver is running on, and then using aws sagemaker and kendra (for timeseries data) build a custom live predicition machine learning model that given a driver would predict the best possible pitstop lap for undercut/overcut strategy and provide insight  
- [x] **nice to have features** 
  - [x] kalshi and polymarket and fanduel betting odds ( live or historical or both ? ) 

- [ ] **cloud config**
  - [ ] ++s3 static files++
    - [ ] ++~~team profile images + metadata?++~~ 
    - [ ] ++track/circuit images++ 
  - [x] Move regulation docs onto AWS-managed Mongodb
  - [ ] config elastic ip for ec2 instance and add it to accepted network ips for atlas
  - [x] config rds (db.t4.micro) for data platform + network inbound rules from only my comptuer for now - change it to elastic ec2 ip once code is pushed there 
  - [x] take snapshot of running db instance to stop getting billed for comptue ( $0.095/GB - for snapshot charge) 

- [ ] **for today** 
  - [ ] build out the data visualization agent to serve the data image over the chat interface, update the AgentState to have mutli turn follow up questions ( forget the image, just need the data ) 
  - [ ] build out the frontend placeholders for the live telemetry (always showing locatoin, live leaderboard, driver lap data, weather, session events, and then race control live update ) then focus on MAX 2 driver select, show the comapriosn between the drivers for the break and gas thorttle percentage over the lap when selected, and its drawn out in real time with overlay and then in the future something like aws bedrock or sagemaker to take that live data and then predict what lap will be the next striking distance.
  - [ ] after building out the bento box live telemetry holdings, aws infra. need to have the ec2 instance, the databse running, and the s3 bucket, and then config the github pipeline to be sending update to those. no config for sqs, fargate, ecr, and subnet. 
  - [ ] also need to ingest in more fia regulation docs and push to mongodb. 
  - [ ] build a workflow to answer questions just about the data between the drivers, create a new workflow instead of just having the data visualizatoin agent, the data responder ? ?  ?

```markdown
- [ ] Cloud - infra setup and config 
- [ ] Live Telemetry Frontend 
- [ ] Live Telemetry Backend. 
- [ ] Chatbot Backend (Langgraph build out and func ) 
- [ ] generate a video about the functionality so far ( have the live telemetry just be mock data for now like 2 mins of a race) and then apply to wealthsimple and then also apply to Formula E for Metrics & Observability  
```

