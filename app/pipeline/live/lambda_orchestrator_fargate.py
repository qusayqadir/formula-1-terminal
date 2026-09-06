
import asyncio
import json
import logging
import os
import ssl

import aiomqtt
import boto3
import httpx
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

openf1_token_username = os.environ["openf1_username"]
openf1_token_password = os.environ["openf1_password"]

# ── ECS config (fill these in for your account) ───────────────────────────
REGION = "us-east-1"
CLUSTER_NAME = "my-fargate-cluster"
TASK_DEFINITION = "f1-stream-worker"
SUBNETS = ["subnet-xxxxxxxxxxxxxxxxx"]
SECURITY_GROUPS = ["sg-xxxxxxxxxxxxxxxxx"]
ASSIGN_PUBLIC_IP = "ENABLED"


def _run_fargate_task(ecs_client) -> str | None:
    """Launch the stream worker on Fargate SPOT. Returns the new task ARN (or None)."""
    run_response = ecs_client.run_task(
        cluster=CLUSTER_NAME,
        taskDefinition=TASK_DEFINITION,
        count=1,
        capacityProviderStrategy=[{"capacityProvider": "FARGATE_SPOT", "weight": 1}],
        networkConfiguration={
            "awsvpcConfiguration": {
                "subnets": SUBNETS,
                "securityGroups": SECURITY_GROUPS,
                "assignPublicIp": ASSIGN_PUBLIC_IP,
            }
        },
    )

    failures = run_response.get("failures") or []
    if failures:
        logger.error("run_task failed: %s", failures)
        return None

    task_arn = run_response["tasks"][0]["taskArn"]
    logger.info("started stream worker: %s", task_arn)
    return task_arn


def _stop_fargate_task(ecs_client, task_arn: str) -> str:

    stop_response = ecs_client.stop_task(
        cluster=CLUSTER_NAME,
        task=task_arn,
        reason="OpenF1 healthcheck unhealthy / session ended",
    )
    last_status = stop_response["task"]["lastStatus"]
    logger.info("stopping stream worker %s (lastStatus=%s)", task_arn, last_status)
    return last_status


def _session_is_live(payload: str) -> bool:

    try:
        body = json.loads(payload)
    except json.JSONDecodeError:
        logger.warning("dropping malformed healthcheck payload")
        return False
    return bool(body.get("status"))


async def openf1_healthcheck() -> None:
    async with httpx.AsyncClient(timeout=10) as http:  
        response = await http.post(
            "https://api.openf1.org/token",
            data={
                "username": openf1_token_username,
                "password": openf1_token_password,
            },
        )
        response.raise_for_status()
        token = response.json()["access_token"]

    ecs_client = boto3.client("ecs", region_name=REGION)  
    task_arn: str | None = None  

    async with aiomqtt.Client(
        hostname="mqtt.openf1.org",
        port=8883,
        username=openf1_token_username,
        password=token,
        tls_context=ssl.create_default_context(),
    ) as client:
        await client.subscribe("v1/healthcheck")

        async for message in client.messages:
            live = _session_is_live(message.payload.decode())

            if live and task_arn is None:
                task_arn = _run_fargate_task(ecs_client)
            elif not live and task_arn is not None:
                _stop_fargate_task(ecs_client, task_arn)
                task_arn = None


if __name__ == "__main__":
    asyncio.run(openf1_healthcheck())
