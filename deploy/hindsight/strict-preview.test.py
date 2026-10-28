"""Execute the actual patched extraction functions, without installing a native runtime.

This source/control fixture is independent of the real image/HTTP/PG qualification.
"""
import ast
import asyncio
import logging
import pathlib
import sys
import types

logging.disable(logging.CRITICAL)
source = pathlib.Path(sys.argv[1])
namespace = {'__name__': 'strict_preview_fixture'}
exec(pathlib.Path(__file__).with_name('strict-preview.py').read_text(), namespace)
active = namespace['active']
active_context = namespace['_active']

class Usage:
    input_tokens = 0
    def __add__(self, _):
        return self

class Overflow(Exception):
    pass

sys.modules['openai'] = types.SimpleNamespace(BadRequestError=type('BadRequestError', (Exception,), {}))
functions = ast.parse((source / 'engine/retain/fact_extraction.py').read_text())
names = {'_extract_facts_from_chunk', '_extract_facts_with_auto_split'}
selected = [node for node in functions.body if isinstance(node, ast.AsyncFunctionDef) and node.name in names]
fixture = {
    'strict_preview_active': active, 'TokenUsage': Usage, 'OutputTooLongError': Overflow,
    'PromptCachePrefix': lambda **kwargs: None,
    'build_chunk_prompt_parts': lambda *args, **kwargs: types.SimpleNamespace(system_prompt='synthetic', response_schema={}, user_message='synthetic'),
    '_expected_fact_keys': lambda _: [], '_coerce_fact_response': lambda value: value,
    '_coerce_entity_strings': lambda value: value or [], 'parse_entity_labels': lambda _: None,
    'Fact': lambda **kwargs: types.SimpleNamespace(**kwargs),
    'logger': logging.getLogger('strict-preview-fixture'),
}
compiled = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0)] + selected, type_ignores=[])
exec(compile(ast.fix_missing_locations(compiled), str(source / 'engine/retain/fact_extraction.py'), 'exec'), fixture)
config = types.SimpleNamespace(retain_extraction_mode='concise', retain_extract_causal_links=False,
    retain_llm_max_retries=4, llm_max_retries=4, retain_llm_initial_backoff=0,
    retain_llm_max_backoff=0, llm_temperature_retain=0, llm_strict_schema_retain=False,
    retain_max_completion_tokens=100, entity_labels=None, entities_allow_free_form=True)

async def run():
    for size, result in [(800, 'overflow'), (200, 'overflow'), (200, {'facts':[None]}),
                         (200, {'facts':[{'what':'Supported synthetic fact.','fact_type':'world'},None]}),
                         (200, {'facts':[{'what':''}]}), (200, {'facts':[]})]:
        calls=[]
        async def call(**kwargs):
            calls.append(kwargs)
            if result == 'overflow':
                raise Overflow()
            return types.SimpleNamespace(content=result,usage=Usage())
        provider = types.SimpleNamespace(call=call,model="synthetic")
        token=active_context.set(True)
        try:
            value=await fixture['_extract_facts_with_auto_split'](chunk='x'*size,chunk_index=0,total_chunks=1,event_date=None,context='',llm_config=provider,config=config)
            assert result == {'facts':[]}, 'Incomplete selection became successful empty/partial'
            assert value[0] == []
        except (Overflow, RuntimeError, ValueError):
            assert result != {'facts':[]}, 'True abstention failed'
        finally:
            active_context.reset(token)
        assert len(calls)==1, 'Native split/content retry dispatched more than once'
        assert calls[0]['max_retries']==0, 'Transport retry budget was not zero'
    print('strict-preview actual native control fixture: 6 passed')

asyncio.run(run())
